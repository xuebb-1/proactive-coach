import { prisma } from "@/lib/db";
import { currentEventKey, writeTransaction } from "@/lib/operations";
import type { Prisma } from "@/app/generated/prisma/client";

export const DISLIKE_THRESHOLD = 0.5;
const DAY = 86400000;

export async function recordSwap(userId: string, mealKey: string) {
  return recordPreferenceSignal(userId, mealKey, "dislike");
}

export async function recordCompletion(userId: string, mealKey: string) {
  return recordPreferenceSignal(userId, mealKey, "like");
}

export async function recordPreferenceSignal(userId: string, mealKey: string, signal: "dislike" | "like") {
  return writeTransaction(async (db) => {
    const event = currentEventKey();
    if (event) {
      const evidence = await db.preferenceEvidence.createMany({
        data: [{ key: `${event}:preference:${mealKey}:${signal}` }], skipDuplicates: true,
      });
      if (!evidence.count) return;
    }
    const boost = signal === "dislike" ? 0.2 : 0.15;
    const key = `${signal === "dislike" ? "dislike" : "prefer"}:${mealKey}`;
    const opposite = `${signal === "dislike" ? "prefer" : "dislike"}:${mealKey}`;
    const now = new Date();
    await db.preferenceMemory.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, category: "food", confidence: 0.3 + boost, source: "button_action", lastConfirmedAt: now },
      update: { confidence: { increment: boost }, evidenceCount: { increment: 1 }, lastConfirmedAt: now, lastDecayedAt: null },
    });
    const pref = await db.preferenceMemory.findUniqueOrThrow({ where: { userId_key: { userId, key } } });
    if (pref.confidence > 1) await db.preferenceMemory.update({ where: { id: pref.id }, data: { confidence: 1 } });
    await attenuate(db, userId, opposite, boost);
  });
}

async function attenuate(db: Prisma.TransactionClient, userId: string, key: string, amount: number) {
  const pref = await db.preferenceMemory.findUnique({ where: { userId_key: { userId, key } } });
  if (pref) await db.preferenceMemory.update({ where: { id: pref.id }, data: { confidence: Math.max(0, pref.confidence - amount) } });
}

export async function confirmDislike(userId: string, mealKey: string) {
  return writeTransaction(async (db) => {
    const pref = await db.preferenceMemory.findUnique({ where: { userId_key: { userId, key: `dislike:${mealKey}` } } });
    if (pref) await db.preferenceMemory.update({
      where: { id: pref.id }, data: { confidence: Math.max(pref.confidence, 0.7), source: "user_confirmed", lastConfirmedAt: new Date(), lastDecayedAt: null },
    });
  });
}

export async function revertSwapSignal(userId: string, mealKey: string) {
  return writeTransaction((db) => attenuate(db, userId, `dislike:${mealKey}`, 0.2));
}

/** Grace period: 14 days. Each subsequent completed week is charged only once. */
export async function decayStalePreferences(userId: string, now = new Date()) {
  return writeTransaction(async (db) => {
    const stale = await db.preferenceMemory.findMany({
      where: { userId, lastConfirmedAt: { lte: new Date(now.getTime() - 14 * DAY) }, confidence: { gt: 0 }, source: { not: "user_confirmed" } },
    });
    for (const pref of stale) {
      const firstDecay = pref.lastConfirmedAt.getTime() + 14 * DAY;
      const from = pref.lastDecayedAt?.getTime() ?? firstDecay - 7 * DAY;
      const weeks = Math.floor((now.getTime() - from) / (7 * DAY));
      if (weeks < 1) continue;
      await db.preferenceMemory.update({
        where: { id: pref.id },
        data: { confidence: Math.max(0, pref.confidence - 0.1 * weeks), lastDecayedAt: new Date(from + weeks * 7 * DAY) },
      });
    }
  });
}

export async function searchPreferences(userId: string, opts: { category?: string; minConfidence?: number } = {}) {
  return prisma.preferenceMemory.findMany({
    where: { userId, category: opts.category, confidence: opts.minConfidence !== undefined ? { gte: opts.minConfidence } : undefined },
    orderBy: { confidence: "desc" },
  });
}

export async function getActiveDislikedMealKeys(userId: string): Promise<string[]> {
  const rows = await prisma.preferenceMemory.findMany({
    where: { userId, category: "food", key: { startsWith: "dislike:" }, confidence: { gte: DISLIKE_THRESHOLD } },
  });
  return rows.map((row) => row.key.replace("dislike:", ""));
}
