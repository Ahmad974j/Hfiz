import { DEFAULT_CONFIG, type Config } from './config';
import { DAY_MS, elapsedDays } from './clock';

/** R(t) = target ^ (t / S): equals `target` exactly when t = S. */
export function retention(tDays: number, S: number, cfg: Config = DEFAULT_CONFIG): number {
  if (S <= 0) return 0;
  return Math.pow(cfg.targetRetention, tDays / S);
}

export function retentionAt(lastReviewedAt: number | null, S: number, nowMs: number, cfg: Config = DEFAULT_CONFIG) {
  if (lastReviewedAt == null) return 0;
  return retention(elapsedDays(lastReviewedAt, nowMs), S, cfg);
}

/** Due date: the moment R drops to the target retention, i.e. last + S days. */
export function dueAt(lastReviewedAt: number | null, S: number): number {
  if (lastReviewedAt == null) return -Infinity;
  return lastReviewedAt + S * DAY_MS;
}

export function isDue(lastReviewedAt: number | null, S: number, nowMs: number): boolean {
  return nowMs >= dueAt(lastReviewedAt, S);
}
