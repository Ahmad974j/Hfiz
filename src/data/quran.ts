// Loads the Quran text built from Tanzil's verbatim Uthmani file (see scripts/build-quran.mjs).

export interface QWord {
  /** word text, verbatim */
  t: string;
  /** trailing Quranic mark(s) (pause / sajdah), verbatim */
  m?: string;
}
export interface QAyah {
  n: number;
  page: number;
  words: QWord[];
}
export interface QSurah {
  number: number;
  nameAr: string;
  nameTr: string;
  nameEn: string;
  basmala: string | null;
  ayat: QAyah[];
}
export interface QuranData {
  source: { name: string; url: string; license: string; sha256: string; notice: string };
  surahs: QSurah[];
}

let cache: Promise<QuranData> | null = null;

export function loadQuran(): Promise<QuranData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}quran/quran.json`).then((r) => {
      if (!r.ok) throw new Error(`Impossible de charger le texte (${r.status})`);
      return r.json();
    });
  }
  return cache;
}

export class Quran {
  private bySurah = new Map<number, QSurah>();
  constructor(public data: QuranData) {
    for (const s of data.surahs) this.bySurah.set(s.number, s);
  }
  get surahs() {
    return this.data.surahs;
  }
  surah(n: number): QSurah {
    const s = this.bySurah.get(n);
    if (!s) throw new Error(`Sourate ${n} non disponible`);
    return s;
  }
  ayah(s: number, a: number): QAyah {
    return this.surah(s).ayat[a - 1];
  }
  word(id: string): QWord | undefined {
    const [s, a, w] = id.split(':').map(Number);
    return this.bySurah.get(s)?.ayat[a - 1]?.words[w - 1];
  }
  name(n: number) {
    return this.bySurah.get(n)?.nameTr ?? `Sourate ${n}`;
  }
  wordCounts(s: number, from: number, to: number): Record<number, number> {
    const out: Record<number, number> = {};
    for (let a = from; a <= to; a++) out[a] = this.ayah(s, a).words.length;
    return out;
  }
  /** Flat list of word ids of a surah, in reading order. */
  wordIds(s: number): string[] {
    return this.surah(s).ayat.flatMap((a) => a.words.map((_, i) => `${s}:${a.n}:${i + 1}`));
  }
}
