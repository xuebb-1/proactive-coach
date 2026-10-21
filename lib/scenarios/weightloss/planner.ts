import { UserInputError } from "@/lib/user-error";
import { prisma } from "@/lib/db";
import { getActiveDislikedMealKeys } from "@/lib/memory/preference";
import { getMealLibrary, type Recipe } from "./meals";

export class NoCandidateMealsError extends UserInputError {
  constructor() { super("目前没有符合忌口的可用方案，请在菜品库补充或启用其他方案。"); }
}

function matchesExplicitDislike(recipe: Recipe, dislikedFoods: string[]) {
  const text = [recipe.title, ...recipe.tags].join(" ").toLowerCase();
  return dislikedFoods.some((food) => food.trim() && text.includes(food.trim().toLowerCase()));
}

/** Only recent repeats may be relaxed. Never relax food exclusions or the meal being swapped away. */
export async function getCandidateMeals(userId: string, explicitDislikedFoods: string[], extraExcludeKeys: string[] = []): Promise<Recipe[]> {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { eatingMode: true } });
  const [library, disliked, recentPlans] = await Promise.all([
    getMealLibrary(profile?.eatingMode ?? "canteen"),
    getActiveDislikedMealKeys(userId),
    prisma.dailyPlan.findMany({
      where: { userId, type: "MORNING", createdAt: { gte: new Date(Date.now() - 3 * 86400000) }, mealKey: { not: null } },
      select: { mealKey: true },
    }),
  ]);
  const excluded = new Set([...disliked, ...extraExcludeKeys]);
  const eligible = library.filter((meal) => !excluded.has(meal.key) && !matchesExplicitDislike(meal, explicitDislikedFoods));
  const recent = new Set(recentPlans.map((plan) => plan.mealKey));
  const fresh = eligible.filter((meal) => !recent.has(meal.key));
  return fresh.length ? fresh : eligible;
}

function pick(candidates: Recipe[], seed: string): Recipe {
  if (!candidates.length) throw new NoCandidateMealsError();
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return candidates[hash % candidates.length];
}

export async function pickMealForDate(userId: string, dateKey: string, explicitDislikedFoods: string[]) {
  return pick(await getCandidateMeals(userId, explicitDislikedFoods), `${userId}:${dateKey}`);
}

export async function pickSwapMeal(userId: string, dateKey: string, currentMealKey: string, explicitDislikedFoods: string[]) {
  return pick(await getCandidateMeals(userId, explicitDislikedFoods, [currentMealKey]), `${userId}:${dateKey}:swap:${currentMealKey}`);
}
