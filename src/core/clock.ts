export const DAY_MS = 86_400_000;

let offsetDays = 0;

/** Debug: shift "now" by N days to test scheduling without waiting. */
export function setSimulatedOffset(days: number) {
  offsetDays = days;
}
export function getSimulatedOffset() {
  return offsetDays;
}

export function now(): number {
  return Date.now() + offsetDays * DAY_MS;
}

/** Local calendar day key "YYYY-MM-DD". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function elapsedDays(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}
