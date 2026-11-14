import type { Mistake } from '../core/types';

export interface RecitationContext {
  surah: number;
  fromAyah: number;
  toAyah: number;
}

/**
 * Anything that can propose mistakes for a recitation.
 * The manual source proposes nothing (the student taps words).
 * A future speech-recognition source will pre-fill mistakes that the
 * student confirms or corrects; manual tapping always stays available.
 */
export interface MistakeSource {
  id: string;
  label: string;
  /** Called when a recitation starts; may return proposed mistakes later (e.g. after audio). */
  propose(ctx: RecitationContext, signal?: AbortSignal): Promise<Mistake[]>;
}

export const manualSource: MistakeSource = {
  id: 'manual',
  label: 'Saisie manuelle',
  propose: async () => [],
};

export const mistakeSources: MistakeSource[] = [manualSource];
