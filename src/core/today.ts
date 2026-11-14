import { DEFAULT_CONFIG, type Config } from './config';
import { dayKey } from './clock';
import { isIntensiveDue } from './intensive';
import { isDue, retentionAt } from './retention';
import type { AyahState, SectionState } from './recitation';
import type { WeakWordCard } from './weakWords';

export interface IntensiveGroup {
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** min clean-day progress over the group */
  cleanDays: number;
  doneToday: boolean;
}

export type TodayItem =
  | { kind: 'intensive-ayat'; group: IntensiveGroup; minutes: number }
  | { kind: 'section'; section: SectionState; R: number; minutes: number }
  | { kind: 'word'; card: WeakWordCard; intensive: boolean; minutes: number };

/** Group consecutive intensive ayat of the same surah: "Al-Mulk 15–16". */
export function groupIntensiveAyat(states: AyahState[], today: string): IntensiveGroup[] {
  const active = states
    .filter((s) => s.intensive.active)
    .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
  const groups: IntensiveGroup[] = [];
  for (const s of active) {
    const last = groups[groups.length - 1];
    const doneToday = s.lastAttemptDay === today;
    if (last && last.surah === s.surah && last.toAyah === s.ayah - 1) {
      last.toAyah = s.ayah;
      last.cleanDays = Math.min(last.cleanDays, s.intensive.cleanDays);
      last.doneToday = last.doneToday && doneToday;
    } else {
      groups.push({ surah: s.surah, fromAyah: s.ayah, toAyah: s.ayah, cleanDays: s.intensive.cleanDays, doneToday });
    }
  }
  return groups;
}

export interface TodayPlan {
  items: TodayItem[];
  /** Items left out because of the time budget. */
  skipped: number;
  totalMinutes: number;
}

/**
 * Today's list: intensive ayat first, then due sections (lowest R first),
 * then due weak words (intensive words first). An optional budget (minutes)
 * truncates the list, but always keeps at least one item.
 */
export function buildToday(
  sections: SectionState[],
  ayahStates: AyahState[],
  cards: WeakWordCard[],
  nowMs: number,
  budgetMinutes: number | null,
  cfg: Config = DEFAULT_CONFIG,
): TodayPlan {
  const today = dayKey(nowMs);
  const all: TodayItem[] = [];

  for (const group of groupIntensiveAyat(ayahStates, today)) {
    if (group.doneToday) continue;
    all.push({ kind: 'intensive-ayat', group, minutes: (group.toAyah - group.fromAyah + 1) * cfg.minutesPerAyah });
  }

  const due = sections
    .filter((s) => s.memorized && isDue(s.lastReviewedAt, s.S, nowMs))
    .map((s) => ({ s, R: retentionAt(s.lastReviewedAt, s.S, nowMs, cfg) }))
    .sort((a, b) => a.R - b.R);
  for (const { s, R } of due) {
    all.push({ kind: 'section', section: s, R, minutes: (s.toAyah - s.fromAyah + 1) * cfg.minutesPerAyah });
  }

  const words = cards
    .filter((c) => !c.retired)
    .map((c) => {
      const lastDay = c.history[c.history.length - 1]?.day;
      const intensive = isIntensiveDue(c.intensive, lastDay, today);
      return { c, intensive, due: intensive || isDue(c.lastReviewedAt, c.S, nowMs) };
    })
    .filter((x) => x.due)
    .sort((a, b) => Number(b.intensive) - Number(a.intensive) || b.c.D - a.c.D);
  for (const { c, intensive } of words) all.push({ kind: 'word', card: c, intensive, minutes: cfg.minutesPerWord });

  if (budgetMinutes == null || budgetMinutes <= 0) {
    return { items: all, skipped: 0, totalMinutes: all.reduce((n, i) => n + i.minutes, 0) };
  }
  const items: TodayItem[] = [];
  let used = 0;
  for (const item of all) {
    if (items.length > 0 && used + item.minutes > budgetMinutes) continue;
    items.push(item);
    used += item.minutes;
  }
  return { items, skipped: all.length - items.length, totalMinutes: used };
}
