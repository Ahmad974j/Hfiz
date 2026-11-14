import { DEFAULT_CONFIG, type Config } from './config';
import { nextStability } from './grading';
import type { Attempt, IntensiveState } from './types';
import { NO_INTENSIVE } from './types';
import { pushAttempt, updateIntensive } from './intensive';
import { dayKey } from './clock';

export interface WeakWordCard {
  wordId: string;
  surah: number;
  ayah: number;
  D: number;
  S: number;
  lastReviewedAt: number;
  retired: boolean;
  history: Attempt[];
  intensive: IntensiveState;
  createdAt: number;
}

export type WordResultSource = 'card' | 'recitation';

/**
 * Apply one result for a word.
 * - mistake: D += 1 (creates the card if needed), S follows "Again"
 * - correct: D = max(0, D - 0.5); on a card review S follows "Good"
 * - D reaching 0 retires the card
 * Returns null when there is no card and the word was correct (nothing to track).
 */
export function applyWordResult(
  card: WeakWordCard | undefined,
  input: { wordId: string; surah: number; ayah: number; ok: boolean; source: WordResultSource; now: number },
  cfg: Config = DEFAULT_CONFIG,
): WeakWordCard | null {
  const { ok, now, source } = input;
  const day = dayKey(now);

  if (!card || card.retired) {
    if (ok) return card ?? null;
    // (re)activate a card
    const history = pushAttempt(card?.history ?? [], { day, ok: false });
    return {
      wordId: input.wordId,
      surah: input.surah,
      ayah: input.ayah,
      D: cfg.weakWord.onMistake,
      S: cfg.initialStability,
      lastReviewedAt: now,
      retired: false,
      history,
      intensive: updateIntensive(NO_INTENSIVE, history, cfg),
      createdAt: card?.createdAt ?? now,
    };
  }

  const history = pushAttempt(card.history, { day, ok });
  const intensive = updateIntensive(card.intensive, history, cfg);

  if (!ok) {
    return {
      ...card,
      D: card.D + cfg.weakWord.onMistake,
      S: nextStability(card.S, 'again', cfg),
      lastReviewedAt: now,
      history,
      intensive,
    };
  }

  const D = Math.max(0, card.D - cfg.weakWord.onCorrect);
  const reviewed = source === 'card';
  return {
    ...card,
    D,
    S: reviewed ? nextStability(card.S, 'good', cfg) : card.S,
    lastReviewedAt: reviewed ? now : card.lastReviewedAt,
    retired: D <= 0 && !intensive.active,
    history,
    intensive,
  };
}
