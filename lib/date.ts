import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export function normalizeTimeZone(timeZone?: string | null) {
  const candidate = timeZone || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function todayKeyForTimeZone(timeZone: string, d: Date = new Date()): string {
  return formatInTimeZone(d, normalizeTimeZone(timeZone), "yyyy-MM-dd");
}

/** Beijing-time calendar day key, e.g. "2026-08-17". Used as the DailyPlan/CheckIn date column. */
export function todayKey(d: Date = new Date()): string {
  return todayKeyForTimeZone(DEFAULT_TIME_ZONE, d);
}

export function endOfDayForTimeZone(timeZone: string, d: Date = new Date()): Date {
  const zone = normalizeTimeZone(timeZone);
  const dateKey = todayKeyForTimeZone(zone, d);
  return fromZonedTime(`${dateKey}T23:59:59.999`, zone);
}

export function startOfDayForTimeZone(timeZone: string, d: Date = new Date()): Date {
  const zone = normalizeTimeZone(timeZone);
  return fromZonedTime(`${todayKeyForTimeZone(zone, d)}T00:00:00.000`, zone);
}

/** Last millisecond of the current Beijing-time day, as an absolute Date. */
export function endOfToday(d: Date = new Date()): Date {
  return endOfDayForTimeZone(DEFAULT_TIME_ZONE, d);
}

export function isDueAt(
  now: Date,
  timeZone: string,
  scheduledTime: string,
  windowMinutes = 5
): boolean {
  const local = formatInTimeZone(now, normalizeTimeZone(timeZone), "HH:mm");
  const [hour, minute] = local.split(":").map(Number);
  const [scheduledHour, scheduledMinute] = scheduledTime.split(":").map(Number);
  if (![hour, minute, scheduledHour, scheduledMinute].every(Number.isFinite)) return false;
  const current = hour * 60 + minute;
  const scheduled = scheduledHour * 60 + scheduledMinute;
  return current >= scheduled && current < scheduled + windowMinutes;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
