import { DEFAULT_CONFIG, type Config } from './config';
import type { Grade, Mistake } from './types';

/** E = (sum of mistake weights) / (number of ayat). */
export function errorScore(mistakes: Mistake[], ayahCount: number, cfg: Config = DEFAULT_CONFIG): number {
  if (ayahCount <= 0) return 0;
  const sum = mistakes.reduce((acc, m) => acc + cfg.weights[m.type], 0);
  return sum / ayahCount;
}

export function gradeFromE(E: number, cfg: Config = DEFAULT_CONFIG): Grade {
  if (E <= 0) return 'easy';
  if (E <= cfg.gradeThresholds.good) return 'good';
  if (E <= cfg.gradeThresholds.hard) return 'hard';
  return 'again';
}

export function nextStability(S: number, grade: Grade, cfg: Config = DEFAULT_CONFIG): number {
  const next = S * cfg.multipliers[grade];
  return grade === 'again' ? Math.max(cfg.minStability, next) : next;
}

export const GRADE_LABEL: Record<Grade, string> = {
  easy: 'Facile',
  good: 'Bien',
  hard: 'Difficile',
  again: 'À revoir',
};
