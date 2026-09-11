import { isDueAt, todayKeyForTimeZone } from "@/lib/date";

export type SchedulableProfile = {
  userId: string;
  timezone: string;
  morningTime: string;
  lunchTime: string;
  eveningTime: string;
};

export type DailyTrigger = "morning" | "lunch" | "evening";

export type DueAgentTrigger = {
  userId: string;
  trigger: DailyTrigger;
  dateKey: string;
  scheduledAt: string;
  dedupeKey: string;
};

export function findDueAgentTriggers(
  profiles: SchedulableProfile[],
  now: Date,
  windowMinutes = 5
): DueAgentTrigger[] {
  const due: DueAgentTrigger[] = [];
  for (const profile of profiles) {
    const dateKey = todayKeyForTimeZone(profile.timezone, now);
    const times: Array<[DailyTrigger, string]> = [
      ["morning", profile.morningTime],
      ["lunch", profile.lunchTime],
      ["evening", profile.eveningTime],
    ];
    for (const [trigger, scheduledTime] of times) {
      if (!isDueAt(now, profile.timezone, scheduledTime, windowMinutes)) continue;
      due.push({
        userId: profile.userId,
        trigger,
        dateKey,
        scheduledAt: now.toISOString(),
        dedupeKey: `agent-daily:${profile.userId}:${dateKey}:${trigger}`,
      });
    }
  }
  return due;
}
