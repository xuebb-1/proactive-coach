import { prisma } from "@/lib/db";
import { currentEventKey, writeTransaction } from "@/lib/operations";
import type { EpisodicEventType, PlanType } from "@/app/generated/prisma/client";

type LogOpts = { userId: string; eventType: EpisodicEventType; planType?: PlanType; mealKey?: string; metadata?: Record<string, unknown> };

/** Append-only events; an operation retry must not create a second piece of evidence. */
export async function logEvent(opts: LogOpts) {
  const operation = currentEventKey();
  const eventKey = operation ? `${operation}:event:${opts.eventType}:${opts.mealKey ?? ""}` : undefined;
  return writeTransaction(async (db) => {
    const data = { ...opts, eventKey, metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined };
    if (eventKey) return db.episodicLog.upsert({ where: { eventKey }, create: data, update: {} });
    return db.episodicLog.create({ data });
  });
}

export async function getRecentEpisodes(userId: string, days = 7, limit = 20) {
  return prisma.episodicLog.findMany({
    where: { userId, createdAt: { gte: new Date(Date.now() - days * 86400000) } },
    orderBy: { createdAt: "desc" }, take: limit,
  });
}
