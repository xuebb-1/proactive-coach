import { prisma } from "@/lib/db";
import { getActiveDislikedMealKeys } from "@/lib/memory/preference";
import { getMealLibrary, type Recipe } from "./meals";

const RECENT_REPEAT_WINDOW_DAYS = 3;

/** The candidate pool depends on how the user actually eats (cook/canteen/takeout). */
async function getLibraryForUser(userId: string): Promise<Recipe[]> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { eatingMode: true },
  });
  return getMealLibrary(profile?.eatingMode ?? "canteen");
}

function hashToIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

async function getExcludedMealKeys(userId: string): Promise<Set<string>> {
  const disliked = await getActiveDislikedMealKeys(userId);

  const cutoff = new Date(Date.now() - RECENT_REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentPlans = await prisma.dailyPlan.findMany({
    where: { userId, type: "MORNING", createdAt: { gte: cutoff }, mealKey: { not: null } },
    select: { mealKey: true },
  });

  const excluded = new Set<string>(disliked);
  for (const p of recentPlans) {
    if (p.mealKey) excluded.add(p.mealKey);
  }
  return excluded;
}

function matchesExplicitDislike(recipe: Recipe, dislikedFoods: string[]): boolean {
  if (dislikedFoods.length === 0) return false;
  return recipe.tags.some((tag) =>
    dislikedFoods.some((d) => d.trim() && tag.includes(d.trim()))
  );
}

/**
 * Filtered candidate list for the Agent's `list_candidate_meals` tool -- the
 * model picks from this set, it never invents a meal. Same filtering rules
 * (Tier2 dislikes + explicit onboarding dislikes + recent-repeat window) as
 * the rule-based picker below, just returning the whole set instead of one
 * hashed choice.
 */
export async function getCandidateMeals(
  userId: string,
  explicitDislikedFoods: string[],
  extraExcludeKeys: string[] = []
): Promise<Recipe[]> {
  const library = await getLibraryForUser(userId);
  const excluded = await getExcludedMealKeys(userId);
  for (const k of extraExcludeKeys) excluded.add(k);

  let candidates = library.filter(
    (r) => !excluded.has(r.key) && !matchesExplicitDislike(r, explicitDislikedFoods)
  );
  if (candidates.length === 0) {
    candidates = library.filter((r) => !matchesExplicitDislike(r, explicitDislikedFoods));
  }
  if (candidates.length === 0) {
    candidates = library.filter((r) => !extraExcludeKeys.includes(r.key));
  }
  if (candidates.length === 0) {
    candidates = library;
  }
  return candidates;
}

/**
 * Deterministic pick (hash of date+user, not random) so re-triggering the
 * same day's cron job is idempotent and doesn't change the answer.
 */
export async function pickMealForDate(
  userId: string,
  dateKey: string,
  explicitDislikedFoods: string[]
): Promise<Recipe> {
  const library = await getLibraryForUser(userId);
  const excluded = await getExcludedMealKeys(userId);

  let candidates = library.filter(
    (r) => !excluded.has(r.key) && !matchesExplicitDislike(r, explicitDislikedFoods)
  );

  // Filters can legitimately exhaust the list (small library, many exclusions).
  // Fall back progressively rather than erroring out.
  if (candidates.length === 0) {
    candidates = library.filter((r) => !matchesExplicitDislike(r, explicitDislikedFoods));
  }
  if (candidates.length === 0) {
    candidates = library;
  }

  const idx = hashToIndex(`${userId}:${dateKey}`, candidates.length);
  return candidates[idx];
}

/** Used by the "swap" action: pick a different meal than the current one. */
export async function pickSwapMeal(
  userId: string,
  dateKey: string,
  currentMealKey: string,
  explicitDislikedFoods: string[]
): Promise<Recipe> {
  const library = await getLibraryForUser(userId);
  const excluded = await getExcludedMealKeys(userId);
  excluded.add(currentMealKey);

  let candidates = library.filter(
    (r) => !excluded.has(r.key) && !matchesExplicitDislike(r, explicitDislikedFoods)
  );
  if (candidates.length === 0) {
    candidates = library.filter((r) => r.key !== currentMealKey);
  }

  const idx = hashToIndex(`${userId}:${dateKey}:swap:${Date.now()}`, candidates.length);
  return candidates[idx];
}
