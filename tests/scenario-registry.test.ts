import { describe, expect, it } from "vitest";
import { getScenario, listScenarioIds } from "@/lib/scenarios/registry";

describe("scenario registry", () => {
  it("registers weightloss without coupling the runner to its modules", () => {
    expect(listScenarioIds()).toEqual(["weightloss"]);
    const scenario = getScenario("weightloss");
    expect(scenario.id).toBe("weightloss");
    expect(scenario.systemPrompt).toContain("减肥习惯教练");
  });

  it("rejects unknown scenarios explicitly", () => {
    expect(() => getScenario("unknown")).toThrow(/Unknown scenario/);
  });
});
