import { DEFAULT_CONFIG, type Config } from './config';
import { errorScore, gradeFromE, nextStability } from './grading';
import { pushAttempt, updateIntensive } from './intensive';
import { applyWordResult, type WeakWordCard } from './weakWords';
import { dayKey } from './clock';
import { ayahKey, NO_INTENSIVE, parseWordId, wordId, type Attempt, type Grade, type IntensiveState, type Mistake } from './types';

export interface AyahState {
  key: string; // "s:a"
  surah: number;
  ayah: number;
  history: Attempt[];
  intensive: IntensiveState;
  lastAttemptDay?: string;
}

export interface SectionState {
  id: string;
  surah: number;
  fromAyah: number;
  toAyah: number;
  memorized: boolean;
  S: number;
  lastReviewedAt: number | null;
}

export interface RecitationInput {
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** Number of words per ayah in the range, keyed by ayah number. */
  wordCounts: Record<number, number>;
  mistakes: Mistake[];
  now: number;
  /** Full-section recitation updates the section's S; "ayah" = intensive drill of a few ayat. */
  section?: SectionState;
  ayahStates: Record<string, AyahState | undefined>;
  cards: Record<string, WeakWordCard | undefined>;
}

export interface RecitationOutcome {
  E: number;
  grade: Grade;
  ayahCount: number;
  section?: SectionState;
  S_before?: number;
  ayahStates: AyahState[];
  /** Cards to upsert (created, updated or retired). */
  cards: WeakWordCard[];
}

/** De-duplicate: one mistake per word (keep the heaviest), one skipped_ayah per ayah. */
export function normalizeMistakes(mistakes: Mistake[], cfg: Config = DEFAULT_CONFIG): Mistake[] {
  const byKey = new Map<string, Mistake>();
  for (const m of mistakes) {
    const { surah, ayah } = parseWordId(m.wordId);
    const key = m.type === 'skipped_ayah' ? `ayah:${surah}:${ayah}` : `word:${m.wordId}`;
    const prev = byKey.get(key);
    if (!prev || cfg.weights[m.type] > cfg.weights[prev.type]) byKey.set(key, m);
  }
  return [...byKey.values()];
}

export function processRecitation(input: RecitationInput, cfg: Config = DEFAULT_CONFIG): RecitationOutcome {
  const { surah, fromAyah, toAyah, now } = input;
  const mistakes = normalizeMistakes(input.mistakes, cfg);
  const ayahCount = toAyah - fromAyah + 1;
  const E = errorScore(mistakes, ayahCount, cfg);
  const grade = gradeFromE(E, cfg);
  const day = dayKey(now);

  let section: SectionState | undefined;
  if (input.section) {
    section = { ...input.section, S: nextStability(input.section.S, grade, cfg), lastReviewedAt: now };
  }

  const skippedAyat = new Set(
    mistakes.filter((m) => m.type === 'skipped_ayah').map((m) => parseWordId(m.wordId).ayah),
  );
  const wordMistakes = new Map(mistakes.filter((m) => m.type !== 'skipped_ayah').map((m) => [m.wordId, m]));

  const ayahStates: AyahState[] = [];
  const cards: WeakWordCard[] = [];

  for (let a = fromAyah; a <= toAyah; a++) {
    const key = ayahKey(surah, a);
    const n = input.wordCounts[a] ?? 0;
    let ayahOk = !skippedAyat.has(a);

    for (let w = 1; w <= n; w++) {
      const id = wordId(surah, a, w);
      const existing = input.cards[id];
      if (skippedAyat.has(a)) continue; // whole ayah missed: tracked at ayah level only
      const mistake = wordMistakes.has(id);
      if (mistake) ayahOk = false;
      if (!mistake && (!existing || existing.retired)) continue;
      const updated = applyWordResult(existing, { wordId: id, surah, ayah: a, ok: !mistake, source: 'recitation', now }, cfg);
      if (updated) cards.push(updated);
    }

    const prev = input.ayahStates[key];
    const history = pushAttempt(prev?.history ?? [], { day, ok: ayahOk });
    ayahStates.push({
      key,
      surah,
      ayah: a,
      history,
      intensive: updateIntensive(prev?.intensive ?? NO_INTENSIVE, history, cfg),
      lastAttemptDay: day,
    });
  }

  return { E, grade, ayahCount, section, S_before: input.section?.S, ayahStates, cards };
}
