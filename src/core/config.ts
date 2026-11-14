// All tunable constants live here. Settings can override any of them at runtime.

export const DEFAULT_CONFIG = {
  /** Mistake weights used in the error score E. */
  weights: {
    hesitation: 0.5,
    wrong: 1,
    skipped_word: 1,
    skipped_ayah: 3,
  },

  /** Grade thresholds on E (upper bounds, inclusive). E = 0 is always Easy. */
  gradeThresholds: { good: 0.2, hard: 0.5 },

  /** Stability multipliers per grade. */
  multipliers: { easy: 3.5, good: 2.5, hard: 1.2, again: 0.3 },
  /** Floor for S after "Again" (days). */
  minStability: 1,
  /** S of a brand-new section or weak-word card (days). */
  initialStability: 1,

  /**
   * Retention model: R(t) = targetRetention ^ (t / S).
   * S is therefore "the number of days after which R falls to targetRetention",
   * and an item is due when t >= S.
   */
  targetRetention: 0.9,

  /** Mastery thresholds on M = R * (1 - min(Ebar, 1)). */
  mastery: { mastered: 0.85, fragile: 0.6 },
  /** Number of recent recitations averaged into Ebar. */
  masteryWindow: 3,

  /** Weak-word difficulty D. */
  weakWord: {
    onMistake: 1,
    onCorrect: 0.5,
    /** Words shown before the hidden word. */
    contextBefore: 4,
    /** Hidden words: the target word + this many following words. */
    hideAfter: 3,
  },

  /** Intensive mode. */
  intensive: {
    /** Enter when >= `enterMistakes` of the last `enterWindow` attempts had a mistake. */
    enterMistakes: 2,
    enterWindow: 3,
    /** Leave after this many separate clean days in a row. */
    exitCleanDays: 3,
  },

  /** Default section size when splitting a surah by ayah count. */
  sectionSize: 7,
  /** "ayat" = fixed number of ayat; "page" = one Madani mushaf page. */
  sectionMode: 'ayat' as 'ayat' | 'page',

  /** Time estimates for the daily budget (minutes). */
  minutesPerAyah: 0.5,
  minutesPerWord: 0.5,
};

export type Config = typeof DEFAULT_CONFIG;

/** Deep-merge partial overrides (from settings) onto the defaults. */
export function mergeConfig(overrides: DeepPartial<Config> | undefined): Config {
  const out = structuredClone(DEFAULT_CONFIG) as Config;
  if (!overrides) return out;
  const merge = (target: any, src: any) => {
    for (const k of Object.keys(src)) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof target[k] === 'object') {
        merge(target[k], src[k]);
      } else if (src[k] !== undefined && k in target) {
        target[k] = src[k];
      }
    }
  };
  merge(out, overrides);
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
