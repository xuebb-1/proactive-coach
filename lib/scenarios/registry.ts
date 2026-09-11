import type { ScenarioPlugin } from "./types";
import { weightlossScenario } from "./weightloss";

const scenarios = new Map<string, ScenarioPlugin>([
  [weightlossScenario.id, weightlossScenario],
]);

export function getScenario(scenarioId = "weightloss"): ScenarioPlugin {
  const scenario = scenarios.get(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  return scenario;
}

export function listScenarioIds() {
  return [...scenarios.keys()];
}
