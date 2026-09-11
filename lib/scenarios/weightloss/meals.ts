import { prisma } from "@/lib/db";

export type EatingMode = "cook" | "canteen" | "takeout";

export const EATING_MODES: EatingMode[] = ["cook", "canteen", "takeout"];

export type Recipe = {
  key: string;
  title: string;
  kcal: number;
  /** Ingredient/style tags, matched against onboarding dislikedFoods substrings. */
  tags: string[];
};

// The meal library lives in the Meal table (seeded by the
// add_meal_knowledge_base migration, editable at /meals). Entries for
// canteen/takeout modes are not dishes to cook but *executable ordering
// strategies*; same Recipe shape, so planner/guardrails don't care.

/** Active entries for one eating mode -- the planner's candidate pool. */
export async function getMealLibrary(userId: string, mode: string): Promise<Recipe[]> {
  const normalized = (EATING_MODES as string[]).includes(mode) ? mode : "canteen";
  return prisma.meal.findMany({
    where: {
      mode: normalized,
      isActive: true,
      OR: [{ ownerId: null }, { ownerId: userId }],
    },
    select: { key: true, title: true, kcal: true, tags: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Lookup by key across all modes, including deactivated entries -- historical
 * plans and episodic logs must keep resolving titles/tags after a meal is
 * removed from the active library.
 */
export async function getRecipeByKey(userId: string, key: string): Promise<Recipe | undefined> {
  const meal = await prisma.meal.findFirst({
    where: { key, OR: [{ ownerId: null }, { ownerId: userId }] },
    select: { key: true, title: true, kcal: true, tags: true },
  });
  return meal ?? undefined;
}

/** Batch lookup for metrics -- one query instead of one per episodic event. */
export async function getRecipesByKeys(userId: string, keys: string[]): Promise<Map<string, Recipe>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const meals = await prisma.meal.findMany({
    where: { key: { in: unique }, OR: [{ ownerId: null }, { ownerId: userId }] },
    select: { key: true, title: true, kcal: true, tags: true },
  });
  return new Map(meals.map((m) => [m.key, m]));
}
