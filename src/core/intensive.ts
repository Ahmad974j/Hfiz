import { DEFAULT_CONFIG, type Config } from './config';
import type { Attempt, IntensiveState } from './types';

/**
 * Update intensive state after a new attempt.
 * `history` must already include `attempt` as its last element (oldest first).
 *
 * - Enter: >= enterMistakes failed attempts among the last enterWindow.
 * - While active: a clean attempt on a new day (and not on a day that already
 *   had a failure) counts one clean day; any failure resets the count.
 * - Exit: after exitCleanDays clean days in a row.
 */
export function updateIntensive(
  state: IntensiveState,
  history: Attempt[],
  cfg: Config = DEFAULT_CONFIG,
): IntensiveState {
  const attempt = history[history.length - 1];
  if (!attempt) return state;
  const { enterMistakes, enterWindow, exitCleanDays } = cfg.intensive;

  if (!state.active) {
    const recent = history.slice(-enterWindow);
    const fails = recent.filter((a) => !a.ok).length;
    if (fails >= enterMistakes) {
      return { active: true, cleanDays: 0, lastFailDay: attempt.day };
    }
    return state;
  }

  if (!attempt.ok) {
    return { active: true, cleanDays: 0, lastFailDay: attempt.day };
  }
  if (attempt.day === state.lastCleanDay || attempt.day === state.lastFailDay) {
    return state; // same day: doesn't count as a separate clean day
  }
  const cleanDays = state.cleanDays + 1;
  if (cleanDays >= exitCleanDays) {
    return { active: false, cleanDays: 0 };
  }
  return { ...state, cleanDays, lastCleanDay: attempt.day };
}

/** Intensive items are due once per calendar day. */
export function isIntensiveDue(state: IntensiveState, lastAttemptDay: string | undefined, today: string) {
  return state.active && lastAttemptDay !== today;
}

/** Keep histories bounded. */
export function pushAttempt(history: Attempt[], attempt: Attempt, max = 10): Attempt[] {
  return [...history, attempt].slice(-max);
}
