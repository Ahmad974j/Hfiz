import Dexie, { type Table } from 'dexie';
import type { AyahState, SectionState } from '../core/recitation';
import type { WeakWordCard } from '../core/weakWords';
import type { Grade, Mistake } from '../core/types';
import type { Config, DeepPartial } from '../core/config';

export interface RecitationRecord {
  id?: number;
  kind: 'section' | 'ayat';
  sectionId?: string;
  surah: number;
  fromAyah: number;
  toAyah: number;
  date: number;
  mistakes: Mistake[];
  E: number;
  grade: Grade;
  S_before?: number;
  S_after?: number;
}

export interface WordReviewRecord {
  id?: number;
  wordId: string;
  date: number;
  ok: boolean;
}

export interface Settings {
  id: 'main';
  config: DeepPartial<Config>;
  budgetMinutes: number | null;
  simOffsetDays: number;
}

export const DEFAULT_SETTINGS: Settings = { id: 'main', config: {}, budgetMinutes: null, simOffsetDays: 0 };

export class HifzDB extends Dexie {
  sections!: Table<SectionState, string>;
  recitations!: Table<RecitationRecord, number>;
  weakWords!: Table<WeakWordCard, string>;
  ayahStates!: Table<AyahState, string>;
  wordReviews!: Table<WordReviewRecord, number>;
  settings!: Table<Settings, string>;

  constructor(name = 'hifz') {
    super(name);
    this.version(1).stores({
      sections: 'id, surah',
      recitations: '++id, sectionId, surah, date',
      weakWords: 'wordId, surah, retired',
      ayahStates: 'key, surah',
      wordReviews: '++id, wordId, date',
      settings: 'id',
    });
  }
}

export const db = new HifzDB();
