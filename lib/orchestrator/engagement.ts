import { prisma } from "@/lib/db";

export type EngagementTrend = "up" | "stable" | "down";

const POSITIVE_STATUSES = new Set(["CONFIRMED", "SWAPPED", "COMPLETED"]);

async function completionRate(userId: string, fromDaysAgo: number, toDaysAgo: number) {
  const from = new Date(Date.now() - fromDaysAgo * 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() - toDaysAgo * 24 * 60 * 60 * 1000);
  const plans = await prisma.dailyPlan.findMany({
    where: { userId, type: "MORNING", createdAt: { gte: from, lt: to } },
    select: { status: true },
  });
  if (plans.length === 0) return null;
  const positive = plans.filter((p) => POSITIVE_STATUSES.has(p.status)).length;
  return positive / plans.length;
}

/**
 * Deliberately simple for v1 -- a 7-day-vs-previous-7-day completion rate
 * comparison, not a learned model. This is the "state trigger" from the plan:
 * it softens tone when engagement drops, per the Noom-style finding that
 * disengaging users need a gentler nudge, not more pressure.
 */
export async function getEngagementTrend(userId: string): Promise<EngagementTrend> {
  const recent = await completionRate(userId, 7, 0);
  const previous = await completionRate(userId, 14, 7);

  if (recent === null) return "stable";
  if (previous === null) return "stable";

  const delta = recent - previous;
  if (delta <= -0.2) return "down";
  if (delta >= 0.2) return "up";
  return "stable";
}
