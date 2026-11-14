// Aligns what the speech model heard for one ayah with the expected words,
// and turns the differences into proposed mistakes. Pure, tested in core.test.ts.

import { normalizeArabic, tokenize, wordSimilarity } from './arabic';
import { wordId, type Mistake } from './types';

export type WordStatus = 'ok' | 'wrong' | 'skipped' | 'hesitation';

export interface AlignedWord {
  /** 0-based index in the ayah. */
  index: number;
  status: WordStatus;
  /** What was heard in place of this word (wrong / ok). */
  heard?: string;
}

export interface AyahAlignment {
  words: AlignedWord[];
  /** Nothing (or almost nothing) of the ayah was recognised. */
  skippedAyah: boolean;
  /** Recognised words that matched nothing (basmala, isti'adha, extra words). */
  extra: string[];
  /** Share of expected words recognised as correct. */
  matchedRatio: number;
}

export interface AlignOptions {
  /** Similarity at or above which a heard word counts as the expected word. */
  accept: number;
  /** Same, when one word is matched with two (stricter: gluing words makes false matches easy). */
  mergeAccept: number;
  /** Below this share of correct words the whole ayah is proposed as skipped / blocked. */
  skippedAyahBelow: number;
  /** A repeated word counts as hesitation if it matches one of the last N expected words. */
  repeatWindow: number;
}

export const DEFAULT_ALIGN: AlignOptions = { accept: 0.75, mergeAccept: 0.9, skippedAyahBelow: 0.25, repeatWindow: 4 };

type Step =
  | { k: 'match'; i: number; j: number; ni: number; nj: number; sim: number }
  | { k: 'del'; i: number }
  | { k: 'ins'; j: number };

/**
 * Word-level edit-distance alignment. Besides 1:1 steps it allows one expected
 * word to match two heard words (يَٰٓأَيُّهَا / "يا أيها") and two expected words
 * to match one heard word ("من ذا" / "منذا").
 */
export function alignAyah(expectedWords: string[], heardText: string, opt: AlignOptions = DEFAULT_ALIGN): AyahAlignment {
  const E = expectedWords.map((w) => normalizeArabic(w).replace(/\s/g, ''));
  const H = tokenize(heardText);
  const n = E.length;
  const m = H.length;

  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const back: (Step | null)[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;

  const subCost = (sim: number) => (sim >= opt.accept ? (1 - sim) * 0.5 : 1);
  const relax = (i: number, j: number, c: number, s: Step) => {
    if (c < cost[i][j] - 1e-9) {
      cost[i][j] = c;
      back[i][j] = s;
    }
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const c = cost[i][j];
      if (c === INF) continue;
      if (i < n) relax(i + 1, j, c + 1, { k: 'del', i });
      if (j < m) relax(i, j + 1, c + 1, { k: 'ins', j });
      if (i < n && j < m) {
        const sim = wordSimilarity(E[i], H[j]);
        relax(i + 1, j + 1, c + subCost(sim), { k: 'match', i, j, ni: 1, nj: 1, sim });
      }
      if (i < n && j + 1 < m) {
        const sim = wordSimilarity(E[i], H[j] + H[j + 1], true);
        if (sim >= opt.mergeAccept) relax(i + 1, j + 2, c + subCost(sim) + 0.1, { k: 'match', i, j, ni: 1, nj: 2, sim });
      }
      if (i + 1 < n && j < m) {
        const sim = wordSimilarity(E[i] + E[i + 1], H[j], true);
        if (sim >= opt.mergeAccept) relax(i + 2, j + 1, c + subCost(sim) + 0.1, { k: 'match', i, j, ni: 2, nj: 1, sim });
      }
    }
  }

  // Walk back.
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = back[i][j]!;
    steps.push(s);
    if (s.k === 'del') i -= 1;
    else if (s.k === 'ins') j -= 1;
    else {
      i -= s.ni;
      j -= s.nj;
    }
  }
  steps.reverse();

  const words: AlignedWord[] = E.map((_, index) => ({ index, status: 'skipped' }));
  const extra: string[] = [];
  const hesitated = new Set<number>();
  let next = 0; // index of the expected word that follows the current position
  for (const s of steps) {
    if (s.k === 'del') {
      next = s.i + 1;
    } else if (s.k === 'match') {
      const heard = H.slice(s.j, s.j + s.nj).join(' ');
      for (let d = 0; d < s.ni; d++) words[s.i + d] = { index: s.i + d, status: s.sim >= opt.accept ? 'ok' : 'wrong', heard };
      next = s.i + s.ni;
    } else {
      // Extra heard word: a repetition of a word just said = hesitation on the next word.
      const w = H[s.j];
      // (If it matches the upcoming word, this is the first of the two copies.)
      const recent = E.slice(Math.max(0, next - opt.repeatWindow), next);
      if (next < n && wordSimilarity(E[next], w) >= opt.accept) hesitated.add(Math.min(next + 1, n - 1));
      else if (next < n && recent.some((e) => wordSimilarity(e, w) >= opt.accept)) hesitated.add(next);
      else extra.push(w);
    }
  }
  // Hesitation only if the word was then said correctly ("wrong" / "skipped" are heavier).
  for (const idx of hesitated) if (words[idx].status === 'ok') words[idx] = { ...words[idx], status: 'hesitation' };

  const okCount = words.filter((w) => w.status === 'ok' || w.status === 'hesitation').length;
  const matchedRatio = n ? okCount / n : 1;
  return { words, skippedAyah: n > 0 && matchedRatio < opt.skippedAyahBelow, extra, matchedRatio };
}

/** Proposed mistakes for one ayah, in the app's Mistake format. */
export function alignmentToMistakes(surah: number, ayah: number, a: AyahAlignment): Mistake[] {
  if (a.skippedAyah) return [{ wordId: wordId(surah, ayah, 1), type: 'skipped_ayah' }];
  const out: Mistake[] = [];
  for (const w of a.words) {
    const id = wordId(surah, ayah, w.index + 1);
    if (w.status === 'wrong') out.push({ wordId: id, type: 'wrong' });
    else if (w.status === 'skipped') out.push({ wordId: id, type: 'skipped_word' });
    else if (w.status === 'hesitation') out.push({ wordId: id, type: 'hesitation' });
  }
  return out;
}
