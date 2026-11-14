import { db, DEFAULT_SETTINGS, type HifzDB, type RecitationRecord, type Settings } from './db';
import type { Quran } from './quran';
import { mergeConfig, type Config } from '../core/config';
import { processRecitation, type SectionState } from '../core/recitation';
import { applyWordResult } from '../core/weakWords';
import { splitSurah, sectionId } from '../core/sections';
import { dueAt } from '../core/retention';
import { setSimulatedOffset } from '../core/clock';
import type { Mistake } from '../core/types';

export async function getSettings(d: HifzDB = db): Promise<Settings> {
  return (await d.settings.get('main')) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>, d: HifzDB = db) {
  const s = { ...(await getSettings(d)), ...patch, id: 'main' as const };
  await d.settings.put(s);
  setSimulatedOffset(s.simOffsetDays);
  return s;
}

export async function getConfig(d: HifzDB = db): Promise<Config> {
  return mergeConfig((await getSettings(d)).config);
}

function buildSections(quran: Quran, surah: number, cfg: Config): SectionState[] {
  return splitSurah(quran.surah(surah).ayat, cfg).map((r) => ({
    id: sectionId(surah, r), surah, ...r, memorized: true, S: cfg.initialStability, lastReviewedAt: null,
  }));
}

/** Mark a whole surah memorized (creates sections if needed) or not. */
export async function setSurahMemorized(quran: Quran, surah: number, memorized: boolean, d: HifzDB = db) {
  const cfg = await getConfig(d);
  await d.transaction('rw', d.sections, async () => {
    const existing = await d.sections.where('surah').equals(surah).toArray();
    if (existing.length === 0) {
      if (memorized) await d.sections.bulkPut(buildSections(quran, surah, cfg));
    } else {
      await d.sections.bulkPut(existing.map((s) => ({ ...s, memorized })));
    }
  });
}

export async function setSectionMemorized(id: string, memorized: boolean, d: HifzDB = db) {
  await d.sections.update(id, { memorized });
}

/** Re-split a surah with the current section settings. Deletes that surah's section history. */
export async function resplitSurah(quran: Quran, surah: number, d: HifzDB = db) {
  const cfg = await getConfig(d);
  await d.transaction('rw', d.sections, d.recitations, async () => {
    const wasMemorized = (await d.sections.where('surah').equals(surah).toArray()).some((s) => s.memorized);
    await d.sections.where('surah').equals(surah).delete();
    await d.recitations.where('surah').equals(surah).filter((r) => r.kind === 'section').delete();
    if (wasMemorized) await d.sections.bulkPut(buildSections(quran, surah, cfg));
  });
}

export interface RecitationResult {
  record: RecitationRecord;
  nextDue?: number;
  newCards: number;
}

export async function saveRecitation(
  quran: Quran,
  args: { surah: number; fromAyah: number; toAyah: number; sectionId?: string; mistakes: Mistake[]; now: number },
  d: HifzDB = db,
): Promise<RecitationResult> {
  const cfg = await getConfig(d);
  const { surah, fromAyah, toAyah, now } = args;
  return d.transaction('rw', [d.sections, d.recitations, d.weakWords, d.ayahStates], async () => {
    const section: SectionState | undefined = args.sectionId ? await d.sections.get(args.sectionId) : undefined;
    const keys = Array.from({ length: toAyah - fromAyah + 1 }, (_, i) => `${surah}:${fromAyah + i}`);
    const ayahStates = Object.fromEntries((await d.ayahStates.bulkGet(keys)).filter(Boolean).map((s) => [s!.key, s!]));
    const cardsArr = await d.weakWords
      .where('surah')
      .equals(surah)
      .filter((c) => c.ayah >= fromAyah && c.ayah <= toAyah)
      .toArray();
    const cards = Object.fromEntries(cardsArr.map((c) => [c.wordId, c]));

    const out = processRecitation(
      { surah, fromAyah, toAyah, wordCounts: quran.wordCounts(surah, fromAyah, toAyah), mistakes: args.mistakes, now, section, ayahStates, cards },
      cfg,
    );

    if (out.section) await d.sections.put(out.section);
    await d.ayahStates.bulkPut(out.ayahStates);
    await d.weakWords.bulkPut(out.cards);
    const record: RecitationRecord = {
      kind: section ? 'section' : 'ayat',
      sectionId: section?.id,
      surah,
      fromAyah,
      toAyah,
      date: now,
      mistakes: args.mistakes,
      E: out.E,
      grade: out.grade,
      S_before: out.S_before,
      S_after: out.section?.S,
    };
    record.id = await d.recitations.add(record);
    return {
      record,
      nextDue: out.section ? dueAt(out.section.lastReviewedAt, out.section.S) : undefined,
      newCards: out.cards.filter((c) => !cards[c.wordId] || cards[c.wordId]!.retired).length,
    };
  });
}

export async function reviewWord(wordIdStr: string, ok: boolean, now: number, d: HifzDB = db) {
  const cfg = await getConfig(d);
  return d.transaction('rw', d.weakWords, d.wordReviews, async () => {
    const card = await d.weakWords.get(wordIdStr);
    if (!card) return null;
    const updated = applyWordResult(card, { wordId: card.wordId, surah: card.surah, ayah: card.ayah, ok, source: 'card', now }, cfg);
    if (updated) await d.weakWords.put(updated);
    await d.wordReviews.add({ wordId: wordIdStr, date: now, ok });
    return updated;
  });
}

// ---------------- export / import ----------------

export const EXPORT_FORMAT = 'hifz-backup';
export const EXPORT_VERSION = 1;

export async function exportData(d: HifzDB = db) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sections: await d.sections.toArray(),
    recitations: await d.recitations.toArray(),
    weakWords: await d.weakWords.toArray(),
    ayahStates: await d.ayahStates.toArray(),
    wordReviews: await d.wordReviews.toArray(),
    settings: await d.settings.toArray(),
  };
}

export async function importData(json: any, d: HifzDB = db) {
  if (json?.format !== EXPORT_FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde Hifz.");
  if (json.version > EXPORT_VERSION) throw new Error('Sauvegarde créée par une version plus récente.');
  await d.transaction('rw', [d.sections, d.recitations, d.weakWords, d.ayahStates, d.wordReviews, d.settings], async () => {
    await Promise.all([d.sections.clear(), d.recitations.clear(), d.weakWords.clear(), d.ayahStates.clear(), d.wordReviews.clear(), d.settings.clear()]);
    await d.sections.bulkPut(json.sections ?? []);
    await d.recitations.bulkPut(json.recitations ?? []);
    await d.weakWords.bulkPut(json.weakWords ?? []);
    await d.ayahStates.bulkPut(json.ayahStates ?? []);
    await d.wordReviews.bulkPut(json.wordReviews ?? []);
    await d.settings.bulkPut(json.settings ?? []);
  });
  setSimulatedOffset((await getSettings(d)).simOffsetDays);
}

export async function resetAll(d: HifzDB = db) {
  await Promise.all(d.tables.map((t) => t.clear()));
  setSimulatedOffset(0);
}
