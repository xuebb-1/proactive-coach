import { prisma } from "@/lib/db";
import { DEFAULT_TIME_ZONE, todayKeyForTimeZone } from "@/lib/date";

export type EngagementTrend = "up" | "stable" | "down";

async function participationRate(userId: string, fromDaysAgo: number, toDaysAgo: number, timezone: string, now: Date) {
  const from = new Date(now.getTime() - fromDaysAgo * 86400000);
  const to = new Date(now.getTime() - toDaysAgo * 86400000);
  const [plans, events] = await Promise.all([
    prisma.dailyPlan.findMany({
      where: { userId, type: "MORNING", createdAt: { gte: from, lt: to } }, select: { date: true },
    }),
    prisma.episodicLog.findMany({
      where: { userId, planType: "MORNING", createdAt: { gte: from, lt: to }, eventType: { in: ["ACTION_CONFIRM", "ACTION_SWAP", "ACTION_COMPLETE"] } },
      select: { createdAt: true },
    }),
  ]);
  if (!plans.length) return null;
  // Participation evidence survives evening resolution to NO_RESPONSE.
  const engagedDays = new Set(events.map((event) => todayKeyForTimeZone(timezone, event.createdAt)));
  return plans.filter((plan) => engagedDays.has(plan.date)).length / plans.length;
}

export async function getEngagementTrend(
  userId: string,
  options: { timezone?: string; now?: Date } = {},
): Promise<EngagementTrend> {
  const timezone = options.timezone ?? (await prisma.userProfile.findUnique({
    where: { userId }, select: { timezone: true },
  }))?.timezone ?? DEFAULT_TIME_ZONE;
  const now = options.now ?? new Date();
  const recent = await participationRate(userId, 7, 0, timezone, now);
  const previous = await participationRate(userId, 14, 7, timezone, now);
  if (recent === null || previous === null) return "stable";
  const delta = recent - previous;
  return delta <= -0.2 ? "down" : delta >= 0.2 ? "up" : "stable";
}
