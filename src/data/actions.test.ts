import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { HifzDB } from './db';
import { Quran } from './quran';
import { exportData, importData, reviewWord, saveRecitation, setSurahMemorized, resplitSurah, saveSettings } from './actions';
import { DAY_MS } from '../core/clock';

const quran = new Quran(JSON.parse(readFileSync('public/quran/quran.json', 'utf8')));
const T0 = new Date(2026, 0, 1, 10).getTime();
let d: HifzDB;
let n = 0;
beforeEach(() => {
  d = new HifzDB(`test-${n++}`);
});

describe('quran data', () => {
  it('contains Al-Mulk and Juz Amma with stable word ids', () => {
    expect(quran.surahs.map((s) => s.number)).toEqual([67, ...Array.from({ length: 37 }, (_, i) => 78 + i)]);
    expect(quran.surah(67).ayat).toHaveLength(30);
    expect(quran.surah(114).ayat).toHaveLength(6);
    expect(quran.word('67:1:1')).toBeDefined();
    expect(quran.data.source.notice).toContain('Tanzil');
  });
});

describe('actions (IndexedDB)', () => {
  it('memorize -> recite -> weak word -> review -> export/import', async () => {
    await setSurahMemorized(quran, 67, true, d);
    const sections = await d.sections.where('surah').equals(67).sortBy('fromAyah');
    expect(sections.map((s) => `${s.fromAyah}-${s.toAyah}`)).toEqual(['1-7', '8-14', '15-21', '22-30']);

    const res = await saveRecitation(quran, {
      surah: 67, fromAyah: 1, toAyah: 7, sectionId: sections[0].id, now: T0,
      mistakes: [{ wordId: '67:2:3', type: 'wrong' }],
    }, d);
    expect(res.record.grade).toBe('good'); // E = 1/7 ≈ 0.14
    expect(res.record.S_after).toBeCloseTo(2.5);
    expect(res.nextDue).toBe(T0 + 2.5 * DAY_MS);
    expect(res.newCards).toBe(1);

    const card = await d.weakWords.get('67:2:3');
    expect(card).toMatchObject({ D: 1, S: 1, retired: false });

    // two correct card reviews retire the word (D: 1 -> 0.5 -> 0)
    await reviewWord('67:2:3', true, T0 + DAY_MS, d);
    const after = await reviewWord('67:2:3', true, T0 + 4 * DAY_MS, d);
    expect(after).toMatchObject({ D: 0, retired: true });
    expect(await d.wordReviews.count()).toBe(2);

    const dump = JSON.parse(JSON.stringify(await exportData(d)));
    const d2 = new HifzDB(`test-import-${n++}`);
    await importData(dump, d2);
    expect(await d2.recitations.count()).toBe(1);
    expect(await d2.weakWords.get('67:2:3')).toMatchObject({ retired: true });
    await expect(importData({ foo: 1 }, d2)).rejects.toThrow();
  });

  it('re-splits a surah by page', async () => {
    await setSurahMemorized(quran, 67, true, d);
    await saveSettings({ config: { sectionMode: 'page' } }, d);
    await resplitSurah(quran, 67, d);
    const sections = await d.sections.where('surah').equals(67).sortBy('fromAyah');
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0].fromAyah).toBe(1);
    expect(sections[sections.length - 1].toAyah).toBe(30);
    expect(sections.every((s) => s.memorized)).toBe(true);
  });

  it('intensive ayah drill does not touch the section S', async () => {
    await setSurahMemorized(quran, 78, true, d);
    const before = await d.sections.where('surah').equals(78).first();
    await saveRecitation(quran, { surah: 78, fromAyah: 2, toAyah: 2, mistakes: [], now: T0 }, d);
    const after = await d.sections.get(before!.id);
    expect(after!.S).toBe(before!.S);
    expect((await d.ayahStates.get('78:2'))!.history).toHaveLength(1);
  });
});
