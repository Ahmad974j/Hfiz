// Builds public/quran/quran.json from the verbatim Tanzil files in data/source/.
// The Quran text is never typed by hand: every word comes from quran-uthmani.txt.
// Text is only *split* (surah > ayah > word); no character is altered.
//
// Usage: npm run build:quran
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC_TEXT = 'data/source/quran-uthmani.txt';
const SRC_META = 'data/source/quran-data.js';
const OUT = 'public/quran/quran.json';

// MVP scope: Al-Mulk (67) + Juz 'Amma (78–114)
const SURAHS = [67, ...Array.from({ length: 114 - 78 + 1 }, (_, i) => 78 + i)];

const raw = readFileSync(SRC_TEXT, 'utf8');
const sha256 = createHash('sha256').update(raw).digest('hex');
const lines = raw.split('\n');

// Copyright block, reproduced verbatim as required by Tanzil's terms.
const notice = lines.filter((l) => l.startsWith('#')).join('\n');

/** @type {Map<string,string>} "s:a" -> ayah text */
const ayat = new Map();
for (const line of lines) {
  const m = /^(\d+)\|(\d+)\|(.*)$/.exec(line);
  if (m) ayat.set(`${m[1]}:${m[2]}`, m[3]);
}
if (ayat.size !== 6236) throw new Error(`Expected 6236 ayat, got ${ayat.size}`);

// ---- metadata (parsed as text, never evaluated) ----
const meta = readFileSync(SRC_META, 'utf8');
const block = (name) => {
  const start = meta.indexOf(`QuranData.${name} = [`);
  const end = meta.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error(`Block ${name} not found`);
  return meta.slice(start, end);
};
const suraRe = /\[(\d+), (\d+), (\d+), (\d+), (['"])(.*?)\5, (['"])(.*?)\7, (['"])(.*?)\9, '(\w+)'\]/g;
const suraMeta = [null];
for (const m of block('Sura').matchAll(suraRe)) {
  suraMeta.push({ ayahCount: +m[2], nameAr: m[6], nameTr: m[8], nameEn: m[10], type: m[11] });
}
if (suraMeta.length !== 115) throw new Error(`Expected 114 surahs, got ${suraMeta.length - 1}`);

const pageStarts = [...block('Page').matchAll(/\[(\d+), (\d+)\]/g)].map((m) => [+m[1], +m[2]]);
// pageStarts[i] is the first ayah of page i+1; the final entry is a sentinel.
const pageOf = (s, a) => {
  let page = 1;
  for (let i = 0; i < pageStarts.length; i++) {
    const [ps, pa] = pageStarts[i];
    if (ps < s || (ps === s && pa <= a)) page = i + 1;
    else break;
  }
  return page;
};

// Basmala = the exact text of 1:1 from the same file (not typed here).
const basmalaText = ayat.get('1:1');
const basmalaTokens = basmalaText.split(' ');

// A token made only of Quranic annotation marks (pause signs, sajdah sign)
// belongs to the previous word.
const isMarkOnly = (tok) => /^[ۖ-ۭ࣓-ࣿ]+$/u.test(tok);

const surahs = SURAHS.map((s) => {
  const sm = suraMeta[s];
  const out = { number: s, nameAr: sm.nameAr, nameTr: sm.nameTr, nameEn: sm.nameEn, basmala: null, ayat: [] };
  for (let a = 1; a <= sm.ayahCount; a++) {
    const text = ayat.get(`${s}:${a}`);
    if (text === undefined) throw new Error(`Missing ${s}:${a}`);
    let tokens = text.split(' ');
    // Some surahs (e.g. 95, 97) carry a shadda on the first letter of the basmala;
    // compare ignoring shadda, but keep the surah's own verbatim tokens.
    const noShadda = (t) => t.replace(/\u0651/gu, '');
    if (a === 1 && s !== 1 && s !== 9 && basmalaTokens.every((t, i) => tokens[i] !== undefined && noShadda(tokens[i]) === noShadda(t))) {
      out.basmala = tokens.slice(0, basmalaTokens.length).join(' ');
      tokens = tokens.slice(basmalaTokens.length);
    }
    const words = [];
    for (const tok of tokens) {
      if (isMarkOnly(tok) && words.length) {
        const w = words[words.length - 1];
        w.m = w.m ? `${w.m} ${tok}` : tok;
      } else {
        words.push({ t: tok });
      }
    }
    // Integrity check: re-joining the pieces must give back the source line exactly.
    const rejoined = [
      ...(a === 1 && out.basmala ? [out.basmala] : []),
      ...words.map((w) => (w.m ? `${w.t} ${w.m}` : w.t)),
    ].join(' ');
    if (rejoined !== text) throw new Error(`Round-trip mismatch at ${s}:${a}`);
    out.ayat.push({ n: a, page: pageOf(s, a), words });
  }
  return out;
});

mkdirSync('public/quran', { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    source: {
      name: 'Tanzil Quran Text (Uthmani)',
      url: 'https://tanzil.net',
      license: 'Creative Commons Attribution 3.0 — verbatim copies only, changing the text is not allowed',
      sha256,
      notice,
    },
    surahs,
  }),
);
const wordCount = surahs.reduce((n, s) => n + s.ayat.reduce((m, a) => m + a.words.length, 0), 0);
console.log(`Wrote ${OUT}: ${surahs.length} surahs, ${wordCount} words (source sha256 ${sha256.slice(0, 12)}…)`);
