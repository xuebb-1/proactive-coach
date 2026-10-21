import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/date";
import { respondToMessage, respondToAskUser, submitCheckin } from "@/lib/orchestrator/actions";
import { runMorning, runLunch, runEvening } from "@/lib/orchestrator/daily-orchestrator";
import { decayStalePreferences, recordSwap } from "@/lib/memory/preference";
import { getCandidateMeals, pickSwapMeal } from "@/lib/scenarios/weightloss/planner";
import { withUserOperation, writeTransaction } from "@/lib/operations";
import { runAgentTurn } from "@/lib/agent/runner";
import { createToolCtx } from "@/lib/agent/tools/context";
import { messagingImpls } from "@/lib/agent/tools/messaging";
import { planningImpls } from "@/lib/agent/tools/planning";
import { getAgentMode } from "@/lib/agent/provider";

vi.mock("@/lib/agent/provider", () => ({
  getAgentMode: vi.fn(() => "mock"),
  getModel: vi.fn(() => { throw new Error("Simulated provider outage"); }),
}));

let user: Awaited<ReturnType<typeof seed>>;
async function seed() {
  const created = await prisma.user.create({ data: {
    profile: { create: { currentWeightKg: 70, goalWeightKg: 65, dislikedFoods: "[]", eatingMode: "cook", morningTime: "07:30", lunchTime: "12:00", eveningTime: "20:30" } },
    persona: { create: { tonePreference: "gentle", motivationHook: "health" } },
  }, include: { profile: true, persona: true } });
  await prisma.meal.createMany({ data: [
    { key: "test_fish", title: "鱼肉饭", tags: ["鱼"], kcal: 500, mode: "cook" },
    { key: "test_chicken", title: "鸡肉饭", tags: ["鸡肉"], kcal: 550, mode: "cook" },
  ] });
  return { ...created, profile: created.profile!, persona: created.persona! };
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(getAgentMode).mockReturnValue("mock");
  await prisma.$executeRaw`TRUNCATE "User", "PreferenceEvidence", "OperationLease", "Meal" CASCADE`;
  user = await seed();
});
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

describe("deployed coach reliability", () => {
  it("never relaxes explicit food exclusions when candidates run out", async () => {
    expect(await getCandidateMeals(user.id, ["鱼", "鸡肉"])).toEqual([]);
    await expect(pickSwapMeal(user.id, todayKey(), "test_chicken", ["鱼"])).rejects.toThrow("没有符合忌口");
    await prisma.meal.updateMany({ data: { tags: [] } });
    expect((await getCandidateMeals(user.id, ["鱼"])).map((meal) => meal.key)).toEqual(["test_chicken"]);
  });

  it("does not silently select the current meal when no swap is available", async () => {
    await prisma.meal.update({ where: { key: "test_fish" }, data: { isActive: false } });
    await expect(pickSwapMeal(user.id, todayKey(), "test_chicken", [])).rejects.toThrow();
  });

  it("decays each elapsed week only once, and preserves explicit confirmations", async () => {
    const confirmedAt = new Date("2026-01-01T00:00:00Z");
    const pref = await prisma.preferenceMemory.create({ data: {
      userId: user.id, key: "dislike:test_fish", category: "food", confidence: 0.8, source: "button_action", lastConfirmedAt: confirmedAt,
    } });
    await decayStalePreferences(user.id, new Date("2026-01-15T00:00:00Z"));
    await decayStalePreferences(user.id, new Date("2026-01-16T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.7);
    await decayStalePreferences(user.id, new Date("2026-01-22T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.6);
    await prisma.preferenceMemory.update({ where: { id: pref.id }, data: { source: "user_confirmed" } });
    await decayStalePreferences(user.id, new Date("2026-05-22T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.6);
  });

  it("deduplicates morning delivery, completion, check-ins and feedback", async () => {
    await runMorning(user);
    await runMorning(user);
    expect(await prisma.message.count({ where: { type: "MORNING", require: { not: "ASK_USER" } } })).toBe(1);
    await runLunch(user);
    const lunch = await prisma.message.findFirstOrThrow({ where: { type: "LUNCH" } });
    await respondToMessage(user.id, lunch.id, "complete");
    await respondToMessage(user.id, lunch.id, "complete");
    const prefer = await prisma.preferenceMemory.findFirstOrThrow({ where: { key: { startsWith: "prefer:" } } });
    expect(prefer.evidenceCount).toBe(1);
    await submitCheckin(user.id, 69);
    await submitCheckin(user.id, 69);
    expect(await prisma.checkIn.count()).toBe(1);
    expect(await prisma.episodicLog.count({ where: { eventType: "CHECKIN" } })).toBe(1);
  });

  it("changes the actual plan and records one swap signal even on retry", async () => {
    await runMorning(user);
    const message = await prisma.message.findFirstOrThrow({ where: { require: "CONFIRM_OR_SWAP" } });
    const before = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    await respondToMessage(user.id, message.id, "swap");
    await respondToMessage(user.id, message.id, "swap");
    const after = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.mealKey).not.toBe(before.mealKey);
    const pref = await prisma.preferenceMemory.findUniqueOrThrow({ where: { userId_key: { userId: user.id, key: `dislike:${before.mealKey}` } } });
    expect(pref.evidenceCount).toBe(1);
    const ask = await prisma.message.findFirstOrThrow({ where: { require: "ASK_USER" } });
    await expect(respondToAskUser(user.id, ask.id, "forged_option")).rejects.toThrow("有效");
    await respondToAskUser(user.id, ask.id, "unavailable");
    await respondToAskUser(user.id, ask.id, "unavailable");
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.3);
  });

  it("recovers a partially completed swap without replacing the meal again", async () => {
    await runMorning(user);
    const message = await prisma.message.findFirstOrThrow({ where: { require: "CONFIRM_OR_SWAP" } });
    const plan = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    const next = plan.mealKey === "test_fish" ? "test_chicken" : "test_fish";
    await prisma.message.update({ where: { id: message.id }, data: { payload: JSON.stringify({ swapFrom: plan.mealKey }) } });
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { mealKey: next, status: "SWAPPED" } });
    await withUserOperation(user.id, `message:${message.id}:swap`, () => recordSwap(user.id, plan.mealKey!));
    await respondToMessage(user.id, message.id, "swap");
    expect((await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } })).mealKey).toBe(next);
    expect((await prisma.preferenceMemory.findFirstOrThrow()).evidenceCount).toBe(1);
  });

  it("rejects expired messages and incompatible transitions", async () => {
    await runMorning(user);
    const message = await prisma.message.findFirstOrThrow({ where: { require: "CONFIRM_OR_SWAP" } });
    await expect(respondToMessage(user.id, message.id, "complete")).rejects.toThrow("不支持");
    await prisma.message.update({ where: { id: message.id }, data: { expiresAt: new Date(0) } });
    await expect(respondToMessage(user.id, message.id, "swap")).rejects.toThrow("过期");
    expect(await prisma.preferenceMemory.count()).toBe(0);
  });

  it("keeps an unreported plan unknown at the evening checkpoint", async () => {
    await runMorning(user);
    await runEvening(user);
    await runEvening(user);
    const plan = await prisma.dailyPlan.findFirstOrThrow({ where: { type: "MORNING" } });
    expect(plan.status).toBe("NO_RESPONSE");
    expect(await prisma.message.count({ where: { type: "EVENING" } })).toBe(1);
    expect(await prisma.preferenceMemory.count()).toBe(0);
  });

  it("returns an actionable empty-candidate message instead of creating an invalid plan", async () => {
    await prisma.meal.updateMany({ data: { isActive: false } });
    await runMorning(user);
    const message = await prisma.message.findFirstOrThrow();
    expect(message.require).toBe("NONE");
    expect(message.text).toContain("没有符合忌口");
    expect(await prisma.dailyPlan.count()).toBe(0);
  });

  it("rejects concurrent operations and fences an expired worker", async () => {
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const first = withUserOperation(user.id, "first", async () => { acquired(); await wait; });
    await ready;
    await expect(withUserOperation(user.id, "second", async () => {})).rejects.toThrow("上一项");
    release();
    await first;
    await withUserOperation(user.id, "expired", async () => {
      await prisma.operationLease.update({ where: { key: `user:${user.id}` }, data: { token: "replacement-worker" } });
      await expect(writeTransaction((db) => db.checkIn.create({ data: { userId: user.id, date: todayKey(), weightKg: 1 } }))).rejects.toThrow("上一项");
    });
    expect(await prisma.checkIn.count()).toBe(0);
  });

  it("deduplicates terminal tools and blocks cross-user or ended plans", async () => {
    await runMorning(user);
    const plan = await prisma.dailyPlan.findFirstOrThrow();
    const ctx = createToolCtx(user.id, todayKey());
    ctx.trigger = "morning"; ctx.finalPlanId = plan.id;
    const args = { planId: plan.id, type: "MORNING" as const, text: "duplicate", require: "CONFIRM_OR_SWAP" as const };
    await messagingImpls.sendProactiveMessage(ctx, args);
    await messagingImpls.sendProactiveMessage(ctx, args);
    expect(await prisma.message.count()).toBe(1);
    ctx.trigger = "swap"; ctx.lastCandidateKeys = new Set(["test_fish", "test_chicken"]);
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED" } });
    await expect(planningImpls.updateDailyPlan(ctx, { planId: plan.id, mealKey: "test_chicken", status: "SWAPPED" })).rejects.toThrow("结束");
  });

  it("retains real-mode failure evidence and delivers a fallback when the model throws", async () => {
    vi.mocked(getAgentMode).mockReturnValue("real");
    const result = await runAgentTurn({ userId: user.id, trigger: "morning", goal: "test", dateKey: todayKey(), explicitDislikedFoods: [] });
    expect(result.status).toBe("incomplete");
    expect(result.finalMessageId).toBeTruthy();
    const trace = await prisma.agentTrace.findUniqueOrThrow({ where: { id: result.traceId } });
    expect(trace.source).toBe("REAL");
    expect(trace.steps).toContain("Simulated provider outage");
  });
});
