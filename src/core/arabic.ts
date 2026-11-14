// Arabic text normalisation and fuzzy word comparison, used to compare what the
// speech model heard with the Uthmani text. Pure functions, no browser APIs.
//
// The Uthmani script differs from everyday (imla'i) spelling: dagger alefs,
// small waw/yeh, alef wasla, dropped alefs (ٱلْكِتَٰبُ vs الكتاب), ة/ه, ى/ي...
// A speech model may output either spelling, so we compare on a normalised
// form, then on a "skeleton" without long vowels.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g;
const NON_ARABIC = /[^ء-ي\s]/g;

/** Normalised letters: no harakat or Quranic marks, unified alef/yeh/hamza/ta marbuta. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[آأإٱٲٳ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/[یے]/g, 'ي') // Persian/Urdu yeh
    .replace(/ک/g, 'ك') // Persian kaf
    .replace(DIACRITICS, '')
    .replace(/ء/g, '') // lone hamza
    .replace(NON_ARABIC, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised word without long vowels / alef, to absorb Uthmani vs imla'i spelling. */
export function skeleton(normalized: string): string {
  return normalized.replace(/[اوي]/g, '');
}

export function tokenize(s: string): string[] {
  const n = normalizeArabic(s);
  return n ? n.split(' ') : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Similarity in [0, 1] between two already-normalised words.
 * `strict` ignores the skeleton distance (used when gluing two words together,
 * where dropping long vowels makes unrelated pairs look alike).
 */
export function wordSimilarity(a: string, b: string, strict = false): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const sa = skeleton(a);
  const sb = skeleton(b);
  if (!strict && sa.length >= 2 && sa === sb) return 0.95;
  const d = Math.min(levenshtein(a, b) / Math.max(a.length, b.length), !strict && sa && sb ? levenshtein(sa, sb) / Math.max(sa.length, sb.length) : 1);
  return Math.max(0, 1 - d);
}
