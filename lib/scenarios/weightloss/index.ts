import {
  SYSTEM_PROMPT,
  buildEveningGoal,
  buildLunchGoal,
  buildMorningGoal,
  buildSwapGoal,
} from "./prompts";
import type { ScenarioPlugin } from "../types";
import { getRecipeByKey, getRecipesByKeys } from "./meals";
import { getCandidateMeals, pickSwapMeal } from "./planner";

export const weightlossScenario: ScenarioPlugin = {
  id: "weightloss",
  systemPrompt: SYSTEM_PROMPT,
  buildMorningGoal,
  buildLunchGoal,
  buildEveningGoal,
  buildSwapGoal,
  getCandidateMeals,
  getRecipeByKey,
  getRecipesByKeys,
  pickSwapMeal,
};
