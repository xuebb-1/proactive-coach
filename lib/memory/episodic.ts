import { prisma } from "@/lib/db";
import type { EpisodicEventType, PlanType } from "@/app/generated/prisma/client";

type LogOpts = {
  userId: string;
  eventType: EpisodicEventType;
  planType?: PlanType;
  mealKey?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Tier 3 memory: append-only raw event log. Never mutate or delete rows here --
 * PreferenceMemory (Tier 2) is derived from this log, and the log itself is
 * what lets a decayed preference be "revived" later if the pattern repeats.
 */
export async function logEvent(opts: LogOpts) {
  return prisma.episodicLog.create({
    data: {
      userId: opts.userId,
      eventType: opts.eventType,
      planType: opts.planType,
      mealKey: opts.mealKey,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    },
  });
}

/** Read access for the Agent's `get_recent_episodes` tool. */
export async function getRecentEpisodes(userId: string, days = 7, limit = 20) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.episodicLog.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
