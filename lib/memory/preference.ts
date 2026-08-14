import { prisma } from "@/lib/db";

const DISLIKE_THRESHOLD = 0.5;
const DECAY_AFTER_DAYS = 14;
const DECAY_STEP = 0.1;
const SWAP_BOOST = 0.2;
const COMPLETE_BOOST = 0.15;

function dislikeKey(mealKey: string) {
  return `dislike:${mealKey}`;
}
function preferKey(mealKey: string) {
  return `prefer:${mealKey}`;
}

/**
 * MVP writes are rule-driven from button actions only -- no LLM extraction.
 * Swapping away from a meal repeatedly raises confidence that it's disliked.
 */
export async function recordSwap(userId: string, mealKey: string) {
  await upsertPreference(userId, dislikeKey(mealKey), "food", SWAP_BOOST, "button_action");
}

/** Completing a meal (without ever swapping it) reinforces it as a preference. */
export async function recordCompletion(userId: string, mealKey: string) {
  await upsertPreference(userId, preferKey(mealKey), "food", COMPLETE_BOOST, "button_action");
}

/**
 * Generic entry point for the Agent's `record_preference_signal` tool. The
 * model only ever chooses a discrete signal ("dislike" | "like") -- the
 * actual confidence math stays in code (SWAP_BOOST/COMPLETE_BOOST), the same
 * guardrail as recordSwap/recordCompletion. Never accept a raw confidence
 * float from the model.
 */
export async function recordPreferenceSignal(
  userId: string,
  mealKey: string,
  signal: "dislike" | "like"
) {
  if (signal === "dislike") return recordSwap(userId, mealKey);
  return recordCompletion(userId, mealKey);
}

async function upsertPreference(
  userId: string,
  key: string,
  category: string,
  boost: number,
  source: string
) {
  const existing = await prisma.preferenceMemory.findUnique({
    where: { userId_key: { userId, key } },
  });

  if (!existing) {
    await prisma.preferenceMemory.create({
      data: {
        userId,
        key,
        category,
        confidence: Math.min(1, 0.3 + boost),
        source,
        evidenceCount: 1,
        lastConfirmedAt: new Date(),
      },
    });
    return;
  }

  await prisma.preferenceMemory.update({
    where: { id: existing.id },
    data: {
      confidence: Math.min(1, existing.confidence + boost),
      evidenceCount: existing.evidenceCount + 1,
      lastConfirmedAt: new Date(),
    },
  });
}

/**
 * Lazily decay confidence for preferences that haven't been reconfirmed in a
 * while, so old signals ("didn't like this 3 months ago") don't stay
 * permanent. Call this once per day (at the morning trigger) before planning.
 */
export async function decayStalePreferences(userId: string) {
  const cutoff = new Date(Date.now() - DECAY_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.preferenceMemory.findMany({
    where: { userId, lastConfirmedAt: { lt: cutoff }, confidence: { gt: 0 } },
  });

  for (const pref of stale) {
    const weeksStale = Math.max(
      1,
      Math.floor((Date.now() - pref.lastConfirmedAt.getTime()) / (7 * 24 * 60 * 60 * 1000))
    );
    const newConfidence = Math.max(0, pref.confidence - DECAY_STEP * weeksStale);
    await prisma.preferenceMemory.update({
      where: { id: pref.id },
      data: { confidence: newConfidence },
    });
  }
}

/** Tier 2 read access for the Agent's `search_preferences` tool. */
export async function searchPreferences(
  userId: string,
  opts: { category?: string; minConfidence?: number } = {}
) {
  return prisma.preferenceMemory.findMany({
    where: {
      userId,
      category: opts.category,
      confidence: opts.minConfidence !== undefined ? { gte: opts.minConfidence } : undefined,
    },
    orderBy: { confidence: "desc" },
  });
}

/** Active (non-decayed) disliked meal keys, used to filter the planner. */
export async function getActiveDislikedMealKeys(userId: string): Promise<string[]> {
  const rows = await prisma.preferenceMemory.findMany({
    where: {
      userId,
      category: "food",
      key: { startsWith: "dislike:" },
      confidence: { gte: DISLIKE_THRESHOLD },
    },
  });
  return rows.map((r) => r.key.replace("dislike:", ""));
}
