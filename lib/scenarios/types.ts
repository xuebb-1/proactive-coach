import type { EngagementTrend } from "@/lib/orchestrator/engagement";

export type ScenarioRecipe = {
  key: string;
  title: string;
  kcal: number;
  tags: string[];
};

export interface ScenarioPlugin {
  id: string;
  systemPrompt: string;
  buildMorningGoal(params: { trend: EngagementTrend; dateKey: string }): string;
  buildLunchGoal(params: {
    dateKey: string;
    morningPlanId: string;
    morningMealTitle: string;
    morningStatus: string;
    alreadyDecided: boolean;
  }): string;
  buildEveningGoal(params: {
    dateKey: string;
    eveningPlanId: string;
    morningOutcome: "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" | "OTHER";
  }): string;
  buildSwapGoal(params: {
    dateKey: string;
    planId: string;
    oldMealKey: string;
    oldMealTitle: string;
  }): string;
  getCandidateMeals(
    userId: string,
    explicitDislikedFoods: string[],
    extraExcludeKeys?: string[]
  ): Promise<ScenarioRecipe[]>;
  getRecipeByKey(userId: string, key: string): Promise<ScenarioRecipe | undefined>;
  getRecipesByKeys(userId: string, keys: string[]): Promise<Map<string, ScenarioRecipe>>;
  pickSwapMeal(
    userId: string,
    dateKey: string,
    currentMealKey: string,
    explicitDislikedFoods: string[]
  ): Promise<ScenarioRecipe>;
}
