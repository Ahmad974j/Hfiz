import { describe, expect, it } from 'vitest';
import { normalizeArabic, wordSimilarity } from './arabic';
import { alignAyah, alignmentToMistakes } from './align';

// Uthmani words as in the Tanzil text (split on spaces, pause marks dropped).
const words = (s: string) => s.split(' ').filter((w) => !/^[ۖ-ۭ]+$/.test(w));
const IKHLAS_4 = words('وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌۢ');
const MULK_1 = words('تَبَـٰرَكَ ٱلَّذِى بِيَدِهِ ٱلْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَىْءٍ قَدِيرٌ');
const MULK_2 = words('ٱلَّذِى خَلَقَ ٱلْمَوْتَ وَٱلْحَيَوٰةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا ۚ وَهُوَ ٱلْعَزِيزُ ٱلْغَفُورُ');

const statuses = (a: ReturnType<typeof alignAyah>) => a.words.map((w) => w.status);

describe('arabic normalisation', () => {
  it('strips harakat and Quranic marks and unifies letters', () => {
    expect(normalizeArabic('ٱلَّذِى')).toBe('الذي');
    expect(normalizeArabic('شَىْءٍ')).toBe('شي');
    expect(normalizeArabic('قَدِيرٌ')).toBe('قدير');
    expect(normalizeArabic('أَحَدٌۢ')).toBe('احد');
    expect(normalizeArabic('لَّهُۥ')).toBe('له');
  });
  it('matches Uthmani and everyday spellings', () => {
    const sim = (a: string, b: string) => wordSimilarity(normalizeArabic(a), normalizeArabic(b));
    expect(sim('تَبَـٰرَكَ', 'تبارك')).toBeGreaterThanOrEqual(0.75);
    expect(sim('وَٱلْحَيَوٰةَ', 'والحياة')).toBeGreaterThanOrEqual(0.75);
    expect(sim('عَلَىٰ', 'على')).toBeGreaterThanOrEqual(0.75);
    expect(sim('شَىْءٍ', 'شيء')).toBeGreaterThanOrEqual(0.75);
    expect(sim('ٱلْمَوْتَ', 'الملك')).toBeLessThan(0.75);
  });
});

describe('alignAyah', () => {
  it('a correct recitation gives no mistakes (with or without harakat)', () => {
    expect(alignmentToMistakes(67, 1, alignAyah(MULK_1, 'تبارك الذي بيده الملك وهو على كل شيء قدير'))).toEqual([]);
    expect(alignmentToMistakes(112, 4, alignAyah(IKHLAS_4, 'وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ'))).toEqual([]);
  });

  it('ignores a basmala said before the ayah', () => {
    const a = alignAyah(MULK_1, 'بسم الله الرحمن الرحيم تبارك الذي بيده الملك وهو على كل شيء قدير');
    expect(alignmentToMistakes(67, 1, a)).toEqual([]);
    expect(a.extra).toEqual(['بسم', 'الله', 'الرحمن', 'الرحيم']);
  });

  it('detects a skipped word', () => {
    const a = alignAyah(MULK_1, 'تبارك الذي بيده الملك وهو على شيء قدير');
    expect(alignmentToMistakes(67, 1, a)).toEqual([{ wordId: '67:1:7', type: 'skipped_word' }]);
  });

  it('detects a wrong word', () => {
    const a = alignAyah(MULK_2, 'الذي خلق الموت والحياة ليبلوكم ايكم احسن عملا وهو العزيز الرحيم');
    expect(alignmentToMistakes(67, 2, a)).toEqual([{ wordId: '67:2:11', type: 'wrong' }]);
    expect(a.words[10].heard).toBe('الرحيم');
  });

  it('a repetition counts as hesitation on the next word', () => {
    const a = alignAyah(MULK_2, 'الذي خلق الموت والحياة ليبلوكم ليبلوكم ايكم احسن عملا وهو العزيز الغفور');
    expect(alignmentToMistakes(67, 2, a)).toEqual([{ wordId: '67:2:6', type: 'hesitation' }]);
  });

  it('stopping early skips the remaining words', () => {
    const a = alignAyah(MULK_2, 'الذي خلق الموت والحياة ليبلوكم ايكم احسن عملا');
    expect(statuses(a).slice(-3)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(a.skippedAyah).toBe(false);
  });

  it('nothing recognised = ayah skipped / blocked', () => {
    expect(alignmentToMistakes(67, 1, alignAyah(MULK_1, ''))).toEqual([{ wordId: '67:1:1', type: 'skipped_ayah' }]);
    // reciting another ayah entirely
    expect(alignAyah(MULK_1, 'الذي خلق سبع سماوات طباقا').skippedAyah).toBe(true);
  });

  it('one Uthmani word can be heard as two words', () => {
    const a = alignAyah(words('يَـٰٓأَيُّهَا ٱلْمُزَّمِّلُ'), 'يا أيها المزمل');
    expect(statuses(a)).toEqual(['ok', 'ok']);
  });
});

describe('alignAyah on the whole bundled text', () => {
  it('every ayah recited correctly gives no mistakes, and a dropped word is found', async () => {
    const { readFileSync } = await import('node:fs');
    const q = JSON.parse(readFileSync(new URL('../../public/quran/quran.json', import.meta.url), 'utf8'));
    let checked = 0;
    let dropFound = 0;
    let dropTotal = 0;
    for (const s of q.surahs) {
      for (const a of s.ayat) {
        const ws: string[] = a.words.map((w: { t: string }) => w.t);
        expect(alignmentToMistakes(s.number, a.n, alignAyah(ws, ws.join(' ')))).toEqual([]);
        checked++;
        if (ws.length >= 4) {
          const k = Math.floor(ws.length / 2);
          const ms = alignmentToMistakes(s.number, a.n, alignAyah(ws, ws.filter((_, i) => i !== k).join(' ')));
          dropTotal++;
          if (ms.length === 1 && ms[0].type === 'skipped_word') dropFound++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    // repeated words (e.g. "كلا كلا") make the exact position ambiguous; still one skipped word
    expect(dropFound / dropTotal).toBeGreaterThan(0.98);
  });
});
