import { DEFAULT_CONFIG, type Config } from './config';

export interface AyahMeta {
  n: number;
  page: number;
}

export interface Range {
  fromAyah: number;
  toAyah: number;
}

export const sectionId = (surah: number, r: Range) => `${surah}:${r.fromAyah}-${r.toAyah}`;

/**
 * Split a surah into sections, either fixed-size or one mushaf page each.
 * A tail of <= 2 ayat is merged into the previous section to avoid tiny sections.
 */
export function splitSurah(ayat: AyahMeta[], cfg: Config = DEFAULT_CONFIG): Range[] {
  if (ayat.length === 0) return [];
  const groups: AyahMeta[][] = [];
  if (cfg.sectionMode === 'page') {
    for (const a of ayat) {
      const last = groups[groups.length - 1];
      if (last && last[0].page === a.page) last.push(a);
      else groups.push([a]);
    }
  } else {
    const size = Math.max(1, Math.round(cfg.sectionSize));
    for (let i = 0; i < ayat.length; i += size) groups.push(ayat.slice(i, i + size));
  }
  if (groups.length > 1 && groups[groups.length - 1].length <= 2 && cfg.sectionMode !== 'page') {
    const tail = groups.pop()!;
    groups[groups.length - 1].push(...tail);
  }
  return groups.map((g) => ({ fromAyah: g[0].n, toAyah: g[g.length - 1].n }));
}
