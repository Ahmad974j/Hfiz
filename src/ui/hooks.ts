import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from '../data/db';
import type { Quran } from '../data/quran';
import { mergeConfig } from '../core/config';
import { now as clockNow, setSimulatedOffset } from '../core/clock';
import { sectionMastery, surahStatus, surahWarning, type SectionMastery } from '../core/mastery';
import type { MasteryStatus } from '../core/types';

export const QuranContext = createContext<Quran | null>(null);
export function useQuran(): Quran {
  const q = useContext(QuranContext);
  if (!q) throw new Error('Quran not loaded');
  return q;
}

export function useSettings() {
  // useLiveQuery returns undefined while loading; the row itself may not exist yet (-> null).
  const row = useLiveQuery(async () => (await db.settings.get('main')) ?? null, []);
  const settingsLoaded = row !== undefined;
  const s = row ?? DEFAULT_SETTINGS;
  // Only sync the global clock offset from real data, never from the loading placeholder.
  if (settingsLoaded) setSimulatedOffset(s.simOffsetDays);
  const cfg = useMemo(() => mergeConfig(s.config), [s.config]);
  return { settings: s, cfg, settingsLoaded };
}

/** Current (possibly simulated) time; refreshes every minute and when the offset changes. */
export function useNow() {
  const { settings } = useSettings();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => clockNow(), [settings.simOffsetDays, Math.floor(Date.now() / 60_000)]);
}

export interface SurahSummary {
  surah: number;
  status: MasteryStatus;
  weakest: SectionMastery | null;
  sections: (SectionMastery & { R: number })[];
  warning: string | null;
}

/** All data needed by Today/Overview, recomputed live. */
export function useDashboard() {
  const quran = useQuran();
  const { settings, cfg, settingsLoaded } = useSettings();
  const nowMs = useNow();
  const sections = useLiveQuery(() => db.sections.toArray(), []);
  const recitations = useLiveQuery(() => db.recitations.orderBy('date').toArray(), []);
  const cards = useLiveQuery(() => db.weakWords.toArray(), []);
  const ayahStates = useLiveQuery(() => db.ayahStates.toArray(), []);

  const loaded = !!(settingsLoaded && sections && recitations && cards && ayahStates);

  const summary = useMemo(() => {
    if (!loaded) return null;
    const esBySection = new Map<string, number[]>();
    for (const r of recitations!) {
      if (r.kind !== 'section' || !r.sectionId) continue;
      const list = esBySection.get(r.sectionId) ?? [];
      list.push(r.E);
      esBySection.set(r.sectionId, list);
    }
    const masteryById = new Map<string, SectionMastery & { R: number }>();
    for (const s of sections!) masteryById.set(s.id, sectionMastery(s, esBySection.get(s.id) ?? [], nowMs, cfg));

    const surahs: SurahSummary[] = [];
    const bySurah = new Map<number, typeof sections>();
    for (const s of sections!) {
      if (!s.memorized) continue;
      bySurah.set(s.surah, [...(bySurah.get(s.surah) ?? []), s]);
    }
    for (const [surah, list] of [...bySurah.entries()].sort((a, b) => a[0] - b[0])) {
      const ms = list!.sort((a, b) => a.fromAyah - b.fromAyah).map((s) => masteryById.get(s.id)!);
      const { status, weakest } = surahStatus(ms);
      const difficult = weakest
        ? cards!.filter((c) => !c.retired && c.surah === surah && c.ayah >= weakest.fromAyah && c.ayah <= weakest.toAyah).length
        : 0;
      surahs.push({ surah, status, weakest, sections: ms, warning: surahWarning(quran.name(surah), status, weakest, difficult) });
    }
    return { masteryById, surahs };
  }, [loaded, sections, recitations, cards, nowMs, cfg, quran]);

  return { loaded, settings, cfg, nowMs, sections, recitations, cards, ayahStates, summary };
}

// ---------------- tiny hash router ----------------

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [path, query = ''] = hash.slice(1).split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function go(to: string) {
  window.location.hash = to;
  window.scrollTo(0, 0);
}

export const toArabicDigits = (n: number) => n.toLocaleString('ar-EG');

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDays(d: number) {
  if (d < 1) return `${Math.round(d * 24)} h`;
  if (d < 60) return `${d.toFixed(d < 10 ? 1 : 0).replace('.', ',')} j`;
  return `${(d / 30).toFixed(1).replace('.', ',')} mois`;
}
