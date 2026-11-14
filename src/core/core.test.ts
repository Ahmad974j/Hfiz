import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from './config';
import { errorScore, gradeFromE, nextStability } from './grading';
import { retention, dueAt, isDue } from './retention';
import { updateIntensive, pushAttempt, isIntensiveDue } from './intensive';
import { applyWordResult, type WeakWordCard } from './weakWords';
import { masteryScore, masteryStatus, surahStatus, sectionMastery, surahWarning, type SectionMastery } from './mastery';
import { splitSurah } from './sections';
import { processRecitation, normalizeMistakes, type SectionState } from './recitation';
import { buildToday, groupIntensiveAyat } from './today';
import { DAY_MS, dayKey } from './clock';
import { NO_INTENSIVE, type Attempt, type IntensiveState } from './types';

const T0 = new Date(2026, 0, 1, 10).getTime();
const day = (n: number) => dayKey(T0 + n * DAY_MS);

describe('error score E', () => {
  it('sums weights and divides by ayah count', () => {
    const E = errorScore(
      [
        { wordId: '1:1:1', type: 'hesitation' },
        { wordId: '1:1:2', type: 'wrong' },
        { wordId: '1:2:1', type: 'skipped_word' },
        { wordId: '1:3:1', type: 'skipped_ayah' },
      ],
      10,
    );
    expect(E).toBeCloseTo((0.5 + 1 + 1 + 3) / 10);
  });
  it('is 0 without mistakes', () => expect(errorScore([], 5)).toBe(0));
});

describe('grades and stability', () => {
  it.each([
    [0, 'easy', 10, 35],
    [0.1, 'good', 10, 25],
    [0.2, 'good', 10, 25],
    [0.3, 'hard', 10, 12],
    [0.5, 'hard', 10, 12],
    [0.6, 'again', 10, 3],
    [2, 'again', 2, 1], // floor at 1 day
  ] as const)('E=%s -> %s, S %s -> %s', (E, grade, S, expected) => {
    const g = gradeFromE(E);
    expect(g).toBe(grade);
    expect(nextStability(S, g)).toBeCloseTo(expected);
  });

  it('a new section starts at S=1', () => {
    expect(DEFAULT_CONFIG.initialStability).toBe(1);
  });
});

describe('retention', () => {
  it('R = 1 at t=0, = target at t=S, decreasing', () => {
    expect(retention(0, 5)).toBe(1);
    expect(retention(5, 5)).toBeCloseTo(0.9);
    expect(retention(10, 5)).toBeCloseTo(0.81);
  });
  it('is due exactly S days after the last review', () => {
    expect(dueAt(T0, 3)).toBe(T0 + 3 * DAY_MS);
    expect(isDue(T0, 3, T0 + 2.9 * DAY_MS)).toBe(false);
    expect(isDue(T0, 3, T0 + 3 * DAY_MS)).toBe(true);
    expect(isDue(null, 1, T0)).toBe(true);
  });
});

describe('intensive mode', () => {
  const run = (attempts: Attempt[]) => {
    let state: IntensiveState = NO_INTENSIVE;
    let history: Attempt[] = [];
    const states: IntensiveState[] = [];
    for (const a of attempts) {
      history = pushAttempt(history, a);
      state = updateIntensive(state, history);
      states.push(state);
    }
    return states;
  };

  it('enters after 2 mistakes in the last 3 attempts', () => {
    const s = run([
      { day: day(0), ok: false },
      { day: day(1), ok: true },
      { day: day(2), ok: false },
    ]);
    expect(s[0].active).toBe(false);
    expect(s[1].active).toBe(false);
    expect(s[2].active).toBe(true);
  });

  it('does not enter when mistakes are spread out (1 in last 3)', () => {
    const s = run([
      { day: day(0), ok: false },
      { day: day(1), ok: true },
      { day: day(2), ok: true },
      { day: day(3), ok: false },
    ]);
    expect(s.every((x) => !x.active)).toBe(true);
  });

  it('exits after 3 clean separate days in a row', () => {
    const s = run([
      { day: day(0), ok: false },
      { day: day(1), ok: false }, // enter
      { day: day(2), ok: true }, // 1/3
      { day: day(3), ok: true }, // 2/3
      { day: day(4), ok: true }, // exit
    ]);
    expect(s[1].active).toBe(true);
    expect(s[2]).toMatchObject({ active: true, cleanDays: 1 });
    expect(s[3]).toMatchObject({ active: true, cleanDays: 2 });
    expect(s[4].active).toBe(false);
  });

  it('several clean attempts on the same day count once', () => {
    const s = run([
      { day: day(0), ok: false },
      { day: day(1), ok: false },
      { day: day(2), ok: true },
      { day: day(2), ok: true },
      { day: day(2), ok: true },
    ]);
    expect(s[4]).toMatchObject({ active: true, cleanDays: 1 });
  });

  it('a mistake resets the clean-day count', () => {
    const s = run([
      { day: day(0), ok: false },
      { day: day(1), ok: false },
      { day: day(2), ok: true },
      { day: day(3), ok: true },
      { day: day(4), ok: false },
      { day: day(4), ok: true }, // same day as the failure: doesn't count
      { day: day(5), ok: true },
    ]);
    expect(s[4]).toMatchObject({ active: true, cleanDays: 0 });
    expect(s[5]).toMatchObject({ active: true, cleanDays: 0 });
    expect(s[6]).toMatchObject({ active: true, cleanDays: 1 });
  });

  it('is due once per day while active', () => {
    const st = { active: true, cleanDays: 1 };
    expect(isIntensiveDue(st, day(1), day(2))).toBe(true);
    expect(isIntensiveDue(st, day(2), day(2))).toBe(false);
    expect(isIntensiveDue(NO_INTENSIVE, day(1), day(2))).toBe(false);
  });
});

describe('weak words', () => {
  const base = { wordId: '67:1:2', surah: 67, ayah: 1, source: 'card' as const };

  it('a mistake creates a card with D=1, S=1', () => {
    const c = applyWordResult(undefined, { ...base, ok: false, now: T0 })!;
    expect(c).toMatchObject({ D: 1, S: 1, retired: false });
  });

  it('correct with no card tracks nothing', () => {
    expect(applyWordResult(undefined, { ...base, ok: true, now: T0 })).toBeNull();
  });

  it('D +1 on mistake, -0.5 on correct, retired at 0', () => {
    let c = applyWordResult(undefined, { ...base, ok: false, now: T0 })!; // D=1
    c = applyWordResult(c, { ...base, ok: true, now: T0 + DAY_MS })!; // 0.5
    expect(c.D).toBe(0.5);
    expect(c.retired).toBe(false);
    expect(c.S).toBeCloseTo(2.5);
    c = applyWordResult(c, { ...base, ok: true, now: T0 + 4 * DAY_MS })!; // 0
    expect(c.D).toBe(0);
    expect(c.retired).toBe(true);
  });

  it('mistake on existing card: D+1 and S follows Again', () => {
    let c: WeakWordCard = { ...applyWordResult(undefined, { ...base, ok: false, now: T0 })!, S: 10 };
    c = applyWordResult(c, { ...base, ok: false, now: T0 + 10 * DAY_MS })!;
    expect(c.D).toBe(2);
    expect(c.S).toBeCloseTo(3);
  });

  it('correct during a section recitation lowers D but keeps the card schedule', () => {
    const c0 = applyWordResult(undefined, { ...base, D: 2, ok: false, now: T0 } as any)!;
    const c1 = applyWordResult({ ...c0, D: 2 }, { ...base, source: 'recitation', ok: true, now: T0 + DAY_MS })!;
    expect(c1.D).toBe(1.5);
    expect(c1.S).toBe(c0.S);
    expect(c1.lastReviewedAt).toBe(c0.lastReviewedAt);
  });
});

describe('mastery', () => {
  it('M = R * (1 - min(Ebar,1))', () => {
    expect(masteryScore(0.9, [0, 0.2, 0.1])).toBeCloseTo(0.9 * 0.9);
    expect(masteryScore(1, [3, 2])).toBe(0);
  });
  it('thresholds', () => {
    expect(masteryStatus(0.85)).toBe('mastered');
    expect(masteryStatus(0.84)).toBe('fragile');
    expect(masteryStatus(0.6)).toBe('fragile');
    expect(masteryStatus(0.59)).toBe('weak');
    expect(masteryStatus(null)).toBe('new');
  });
  it('sectionMastery uses the last 3 recitations only', () => {
    const sec = { id: 'x', fromAyah: 1, toAyah: 5, S: 10, lastReviewedAt: T0 };
    const m = sectionMastery(sec, [5, 5, 0, 0, 0], T0);
    expect(m.M).toBe(1);
    expect(m.status).toBe('mastered');
  });
  it('an on-time, error-free section is mastered; a long-overdue one is not', () => {
    const sec = { id: 'x', fromAyah: 1, toAyah: 5, S: 4, lastReviewedAt: T0 };
    expect(sectionMastery(sec, [0], T0 + 4 * DAY_MS).status).toBe('mastered');
    expect(sectionMastery(sec, [0], T0 + 12 * DAY_MS).status).toBe('fragile');
    expect(sectionMastery(sec, [0], T0 + 25 * DAY_MS).status).toBe('weak');
  });

  const sm = (from: number, M: number | null): SectionMastery => ({
    sectionId: `s${from}`,
    fromAyah: from,
    toAyah: from + 9,
    M,
    status: masteryStatus(M),
  });

  it('surah status is the weakest section, not the average', () => {
    const r = surahStatus([sm(1, 0.99), sm(11, 0.98), sm(21, 0.97), sm(31, 0.3)]);
    expect(r.status).toBe('weak');
    expect(r.weakest?.fromAyah).toBe(31);
  });
  it('picks the lowest M among sections with the same status', () => {
    const r = surahStatus([sm(1, 0.8), sm(11, 0.65), sm(21, 0.9)]);
    expect(r.status).toBe('fragile');
    expect(r.weakest?.fromAyah).toBe(11);
  });
  it('never-recited sections do not hide a known weakness', () => {
    expect(surahStatus([sm(1, 0.7), sm(11, null), sm(21, null)])).toMatchObject({ status: 'fragile', weakest: { fromAyah: 1 } });
    expect(surahStatus([sm(1, 0.95), sm(11, null)]).status).toBe('mastered');
    expect(surahStatus([sm(1, null), sm(11, null)]).status).toBe('new');
  });
  it('all mastered -> mastered; no warning', () => {
    const r = surahStatus([sm(1, 0.9), sm(11, 0.95)]);
    expect(r.status).toBe('mastered');
    expect(surahWarning('Al-Mulk', r.status, r.weakest, 0)).toBeNull();
  });
  it('warning names the weak part', () => {
    const r = surahStatus([sm(1, 0.9), sm(60, 0.2)]);
    expect(surahWarning('Al-Kahf', r.status, r.weakest, 3)).toBe(
      'Al-Kahf : non maîtrisée. Ayat 60–69 sont la partie faible (3 mots difficiles).',
    );
  });
});

describe('sections', () => {
  const ayat = (n: number, perPage = 100) => Array.from({ length: n }, (_, i) => ({ n: i + 1, page: Math.floor(i / perPage) + 1 }));
  it('splits by ayah count and merges a tiny tail', () => {
    expect(splitSurah(ayat(30))).toEqual([
      { fromAyah: 1, toAyah: 7 },
      { fromAyah: 8, toAyah: 14 },
      { fromAyah: 15, toAyah: 21 },
      { fromAyah: 22, toAyah: 30 },
    ]);
    expect(splitSurah(ayat(5))).toEqual([{ fromAyah: 1, toAyah: 5 }]);
  });
  it('splits by page', () => {
    const cfg = mergeConfig({ sectionMode: 'page' });
    expect(splitSurah(ayat(30, 13), cfg)).toEqual([
      { fromAyah: 1, toAyah: 13 },
      { fromAyah: 14, toAyah: 26 },
      { fromAyah: 27, toAyah: 30 },
    ]);
  });
});

describe('processRecitation', () => {
  const section: SectionState = { id: '67:1-3', surah: 67, fromAyah: 1, toAyah: 3, memorized: true, S: 1, lastReviewedAt: null };
  const wordCounts = { 1: 4, 2: 4, 3: 4 };

  it('perfect recitation -> easy, S*3.5, no cards', () => {
    const out = processRecitation({ surah: 67, fromAyah: 1, toAyah: 3, wordCounts, mistakes: [], now: T0, section, ayahStates: {}, cards: {} });
    expect(out.grade).toBe('easy');
    expect(out.section?.S).toBeCloseTo(3.5);
    expect(out.cards).toHaveLength(0);
    expect(out.ayahStates.every((a) => a.history[0].ok)).toBe(true);
  });

  it('word mistakes create cards; skipped ayah does not', () => {
    const out = processRecitation({
      surah: 67, fromAyah: 1, toAyah: 3, wordCounts, now: T0, section, ayahStates: {}, cards: {},
      mistakes: [
        { wordId: '67:1:2', type: 'wrong' },
        { wordId: '67:3:1', type: 'skipped_ayah' },
      ],
    });
    expect(out.E).toBeCloseTo(4 / 3);
    expect(out.grade).toBe('again');
    expect(out.section?.S).toBe(1);
    expect(out.cards.map((c) => c.wordId)).toEqual(['67:1:2']);
    expect(out.ayahStates.map((a) => a.history[0].ok)).toEqual([false, true, false]);
  });

  it('duplicate marks on one word count once (heaviest)', () => {
    const m = normalizeMistakes([
      { wordId: '1:1:1', type: 'hesitation' },
      { wordId: '1:1:1', type: 'wrong' },
    ]);
    expect(m).toEqual([{ wordId: '1:1:1', type: 'wrong' }]);
  });

  it('an ayah wrong in 2 of the last 3 recitations becomes intensive', () => {
    let ayahStates: Record<string, any> = {};
    const recite = (n: number, mistakes: any[]) => {
      const out = processRecitation({ surah: 67, fromAyah: 1, toAyah: 3, wordCounts, mistakes, now: T0 + n * DAY_MS, ayahStates, cards: {} });
      ayahStates = Object.fromEntries(out.ayahStates.map((a) => [a.key, a]));
      return out;
    };
    recite(0, [{ wordId: '67:2:1', type: 'wrong' }]);
    recite(1, []);
    recite(2, [{ wordId: '67:2:3', type: 'hesitation' }]);
    expect(ayahStates['67:2'].intensive.active).toBe(true);
    expect(ayahStates['67:1'].intensive.active).toBe(false);
  });
});

describe('today', () => {
  const sec = (id: string, S: number, last: number | null, memorized = true): SectionState => ({
    id, surah: 67, fromAyah: 1, toAyah: 5, memorized, S, lastReviewedAt: last,
  });

  it('lists due sections sorted by lowest R, ignores not-due and unmemorized', () => {
    const now = T0 + 10 * DAY_MS;
    const plan = buildToday(
      [sec('a', 5, T0), sec('b', 2, T0), sec('c', 100, T0), sec('d', 1, T0, false)],
      [], [], now, null,
    );
    expect(plan.items.map((i) => (i.kind === 'section' ? i.section.id : ''))).toEqual(['b', 'a']);
  });

  it('groups consecutive intensive ayat', () => {
    const st = (a: number, active: boolean, clean = 0) => ({
      key: `67:${a}`, surah: 67, ayah: a, history: [], intensive: { active, cleanDays: clean }, lastAttemptDay: day(0),
    });
    const g = groupIntensiveAyat([st(15, true, 1), st(16, true, 2), st(18, true), st(17, false)], day(1));
    expect(g).toEqual([
      { surah: 67, fromAyah: 15, toAyah: 16, cleanDays: 1, doneToday: false },
      { surah: 67, fromAyah: 18, toAyah: 18, cleanDays: 0, doneToday: false },
    ]);
  });

  it('respects the time budget', () => {
    const now = T0 + 10 * DAY_MS;
    const plan = buildToday([sec('a', 1, T0), sec('b', 1, T0), sec('c', 1, T0)], [], [], now, 5);
    // each section = 5 ayat * 0.5 min = 2.5 min
    expect(plan.items).toHaveLength(2);
    expect(plan.skipped).toBe(1);
  });
});
