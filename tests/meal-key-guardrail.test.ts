import { describe, expect, it } from "vitest";
import { assertValidMealKey } from "@/lib/agent/tools/planning";

/**
 * mealKey 白名单是防止模型幻觉菜名的核心护栏（代码级，不依赖 prompt）。
 */
describe("assertValidMealKey", () => {
  it("accepts a key that was in the latest list_candidate_meals result", () => {
    const ctx = { lastCandidateKeys: new Set(["chicken_broccoli", "salmon_salad"]) };
    expect(() => assertValidMealKey(ctx, "salmon_salad")).not.toThrow();
  });

  it("rejects a real recipe key that was NOT in the latest candidate list", () => {
    const ctx = { lastCandidateKeys: new Set(["chicken_broccoli"]) };
    expect(() => assertValidMealKey(ctx, "salmon_salad")).toThrow(/invalid_meal_key/);
  });

  it("rejects a hallucinated key when no candidate list was fetched", () => {
    const ctx = { lastCandidateKeys: new Set<string>() };
    expect(() => assertValidMealKey(ctx, "unicorn_steak")).toThrow(/invalid_meal_key/);
  });

  it("rejects even a REAL recipe key when no candidate list was fetched (must list first)", () => {
    // 真实事故回归：list_candidate_meals 失败时，模型凭记忆写了一个真实存在
    // 但属于另一个吃饭方式库的 key，旧的"已知菜品放行"分支让它通过了。
    const ctx = { lastCandidateKeys: new Set<string>() };
    expect(() => assertValidMealKey(ctx, "chicken_broccoli")).toThrow(/invalid_meal_key/);
  });
});
