/**
 * All "which calendar day is it" logic is pinned to Asia/Shanghai (UTC+8, no
 * DST), NOT the server's local timezone. On Vercel the server runs in UTC,
 * and the morning cron fires at 23:30 UTC (= 07:30 Beijing next day) -- using
 * server-local dates there would file the plan under yesterday's date and
 * orphan it. Never use `new Date().setHours(...)` / date-fns `format` for
 * day-key math in this codebase; go through these helpers.
 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Beijing-time calendar day key, e.g. "2026-08-17". Used as the DailyPlan/CheckIn date column. */
export function todayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Last millisecond of the current Beijing-time day, as an absolute Date. */
export function endOfToday(d: Date = new Date()): Date {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  const startOfTomorrowShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1
  );
  return new Date(startOfTomorrowShifted - TZ_OFFSET_MS - 1);
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
