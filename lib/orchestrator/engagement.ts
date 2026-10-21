import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/date";

export type EngagementTrend = "up" | "stable" | "down";

async function participationRate(userId: string, fromDaysAgo: number, toDaysAgo: number) {
  const from = new Date(Date.now() - fromDaysAgo * 86400000);
  const to = new Date(Date.now() - toDaysAgo * 86400000);
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
  const engagedDays = new Set(events.map((event) => todayKey(event.createdAt)));
  return plans.filter((plan) => engagedDays.has(plan.date)).length / plans.length;
}

export async function getEngagementTrend(userId: string): Promise<EngagementTrend> {
  const recent = await participationRate(userId, 7, 0);
  const previous = await participationRate(userId, 14, 7);
  if (recent === null || previous === null) return "stable";
  const delta = recent - previous;
  return delta <= -0.2 ? "down" : delta >= 0.2 ? "up" : "stable";
}
