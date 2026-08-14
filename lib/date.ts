import { format } from "date-fns";

/** Local calendar day key, e.g. "2026-08-10". Used as the DailyPlan/CheckIn date column. */
export function todayKey(d: Date = new Date()): string {
  return format(d, "yyyy-MM-dd");
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
