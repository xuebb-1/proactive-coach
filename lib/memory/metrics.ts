import { prisma } from "@/lib/db";
import { getRecipesByKeys } from "@/lib/scenarios/weightloss/meals";

/**
 * Memory-effectiveness metrics, computed read-only from the Tier3 episodic
 * log. This is how we answer "is the memory helping decisions or just noise":
 * if preference learning works, recommendations should get swapped away less
 * over time, and things the user already rejected should stop coming back.
 */

export type WeeklySwapPoint = {
  label: string; // e.g. "本周" / "1周前"
  planned: number;
  swapped: number;
  rate: number | null; // null when no plans that week
};

/** Swap rate per rolling 7-day window, oldest first. */
export async function getWeeklySwapTrend(userId: string, weeks = 4): Promise<WeeklySwapPoint[]> {
  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
  const events = await prisma.episodicLog.findMany({
    where: { userId, createdAt: { gte: since }, eventType: { in: ["PLAN_GENERATED", "ACTION_SWAP"] } },
    select: { eventType: true, createdAt: true },
  });

  const points: WeeklySwapPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = Date.now() - i * 7 * 24 * 60 * 60 * 1000;
    const start = end - 7 * 24 * 60 * 60 * 1000;
    const inWindow = events.filter((e) => {
      const t = e.createdAt.getTime();
      return t > start && t <= end;
    });
    const planned = inWindow.filter((e) => e.eventType === "PLAN_GENERATED").length;
    const swapped = inWindow.filter((e) => e.eventType === "ACTION_SWAP").length;
    points.push({
      label: i === 0 ? "本周" : `${i}周前`,
      planned,
      swapped,
      rate: planned > 0 ? swapped / planned : null,
    });
  }
  return points;
}

export type RepeatMistakeStats = {
  /** Recommendations of a meal (or same-tag meal) the user had already swapped away before. */
  repeatRecommended: number;
  /** ...of which the user swapped away again. */
  repeatSwapped: number;
  rate: number | null;
};

/**
 * "重复踩坑率": among plans that recommended something the user had already
 * rejected (same key, or sharing a tag with a rejected key), how many got
 * rejected again. High = memory exists but decisions ignore it.
 */
export async function getRepeatMistakeStats(userId: string): Promise<RepeatMistakeStats> {
  const events = await prisma.episodicLog.findMany({
    where: { userId, eventType: { in: ["PLAN_GENERATED", "ACTION_SWAP"] }, mealKey: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { eventType: true, mealKey: true, createdAt: true },
  });

  const mealsByKey = await getRecipesByKeys(events.map((e) => e.mealKey!));

  const rejectedKeys = new Set<string>();
  const rejectedTags = new Set<string>();
  let repeatRecommended = 0;
  let repeatSwapped = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const key = e.mealKey!;
    if (e.eventType === "ACTION_SWAP") {
      rejectedKeys.add(key);
      for (const tag of mealsByKey.get(key)?.tags ?? []) rejectedTags.add(tag);
      continue;
    }
    // PLAN_GENERATED: was this a "known rejected" recommendation at this point in time?
    const tags = mealsByKey.get(key)?.tags ?? [];
    const isRepeat = rejectedKeys.has(key) || tags.some((t) => rejectedTags.has(t));
    if (!isRepeat) continue;
    repeatRecommended++;
    const swappedAgain = events.slice(i + 1).some((n) => n.eventType === "ACTION_SWAP" && n.mealKey === key);
    if (swappedAgain) repeatSwapped++;
  }

  return {
    repeatRecommended,
    repeatSwapped,
    rate: repeatRecommended > 0 ? repeatSwapped / repeatRecommended : null,
  };
}

export type InferencePrecision = {
  asked: number;
  confirmed: number;
  precision: number | null;
};

/**
 * "推断准确率": of the swap-attribution questions we asked (ask_user ground
 * truth), how often did the user confirm "yes, I dislike it"? Low precision
 * means swap->dislike attribution is generating noise.
 */
export async function getInferencePrecision(userId: string): Promise<InferencePrecision> {
  const events = await prisma.episodicLog.findMany({
    where: { userId, eventType: "ASK_USER_RESPONDED" },
    select: { metadata: true },
  });

  let asked = 0;
  let confirmed = 0;
  for (const e of events) {
    try {
      const meta = JSON.parse(e.metadata ?? "{}");
      if (meta.kind !== "swap_attribution") continue;
      asked++;
      if (meta.answer === "dislike") confirmed++;
    } catch {
      // ignore malformed metadata
    }
  }
  return { asked, confirmed, precision: asked > 0 ? confirmed / asked : null };
}
