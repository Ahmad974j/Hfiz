export type MistakeType = 'hesitation' | 'wrong' | 'skipped_word' | 'skipped_ayah';

/** wordId = "surah:ayah:wordIndex" (1-based word index, basmala excluded). */
export interface Mistake {
  wordId: string;
  type: MistakeType;
}

export type Grade = 'easy' | 'good' | 'hard' | 'again';

export type MasteryStatus = 'mastered' | 'fragile' | 'weak' | 'new';

/** One attempt at an item (word or ayah), used for intensive mode. */
export interface Attempt {
  /** Local calendar day "YYYY-MM-DD". */
  day: string;
  ok: boolean;
}

export interface IntensiveState {
  active: boolean;
  /** Clean days counted since entering intensive mode. */
  cleanDays: number;
  lastCleanDay?: string;
  lastFailDay?: string;
}

export const NO_INTENSIVE: IntensiveState = { active: false, cleanDays: 0 };

export const wordId = (s: number, a: number, w: number) => `${s}:${a}:${w}`;
export const parseWordId = (id: string) => {
  const [s, a, w] = id.split(':').map(Number);
  return { surah: s, ayah: a, word: w };
};
export const ayahKey = (s: number, a: number) => `${s}:${a}`;
