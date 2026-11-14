import { DEFAULT_CONFIG, type Config } from './config';
import type { MasteryStatus } from './types';
import { retentionAt } from './retention';

/** M = R * (1 - min(Ebar, 1)). */
export function masteryScore(R: number, recentE: number[]): number {
  if (recentE.length === 0) return 0;
  const Ebar = recentE.reduce((a, b) => a + b, 0) / recentE.length;
  return R * (1 - Math.min(Ebar, 1));
}

export function masteryStatus(M: number | null, cfg: Config = DEFAULT_CONFIG): MasteryStatus {
  if (M == null) return 'new';
  if (M >= cfg.mastery.mastered) return 'mastered';
  if (M >= cfg.mastery.fragile) return 'fragile';
  return 'weak';
}

const RANK: Record<MasteryStatus, number> = { weak: 0, fragile: 1, mastered: 2, new: 3 };

export interface SectionMastery {
  sectionId: string;
  fromAyah: number;
  toAyah: number;
  /** null when the section was never recited. */
  M: number | null;
  status: MasteryStatus;
}

/**
 * A surah is only as strong as its weakest *evaluated* section (never-recited
 * sections have no evidence yet, so they don't hide a known weakness).
 * If no section was recited yet, the surah is "new".
 */
export function surahStatus(sections: SectionMastery[]): { status: MasteryStatus; weakest: SectionMastery | null } {
  if (sections.length === 0) return { status: 'new', weakest: null };
  let weakest = sections[0];
  for (const s of sections) {
    const r = RANK[s.status] - RANK[weakest.status];
    if (r < 0 || (r === 0 && (s.M ?? 0) < (weakest.M ?? 0))) weakest = s;
  }
  return { status: weakest.status, weakest };
}

export const STATUS_LABEL: Record<MasteryStatus, string> = {
  mastered: 'Maîtrisé',
  fragile: 'Fragile',
  weak: 'Non maîtrisé',
  new: 'Pas encore récité',
};

export function surahWarning(
  surahName: string,
  status: MasteryStatus,
  weakest: SectionMastery | null,
  difficultWords: number,
): string | null {
  if (!weakest || (status !== 'fragile' && status !== 'weak')) return null;
  const part = `Ayat ${weakest.fromAyah}–${weakest.toAyah}`;
  const words = difficultWords > 0 ? ` (${difficultWords} mot${difficultWords > 1 ? 's' : ''} difficile${difficultWords > 1 ? 's' : ''})` : '';
  if (status === 'fragile') {
    return `${surahName} : fragile. ${part} s'affaiblissent${words}, à réviser bientôt.`;
  }
  return `${surahName} : non maîtrisée. ${part} sont la partie faible${words}.`;
}


/** Mastery of one section from its state and the E of its full recitations (oldest first). */
export function sectionMastery(
  section: { id: string; fromAyah: number; toAyah: number; S: number; lastReviewedAt: number | null },
  recitationEs: number[],
  nowMs: number,
  cfg: Config = DEFAULT_CONFIG,
): SectionMastery & { R: number } {
  const R = retentionAt(section.lastReviewedAt, section.S, nowMs, cfg);
  const recent = recitationEs.slice(-cfg.masteryWindow);
  const M = section.lastReviewedAt == null || recent.length === 0 ? null : masteryScore(R, recent);
  return { sectionId: section.id, fromAyah: section.fromAyah, toAyah: section.toAyah, M, R, status: masteryStatus(M, cfg) };
}
