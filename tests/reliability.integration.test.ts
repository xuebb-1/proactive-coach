import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/date";
import { withUserOperation } from "@/lib/operations";
import { respondToMessage, respondToAskUser, submitCheckin } from "@/lib/orchestrator/actions";
import { runMorning, runLunch } from "@/lib/orchestrator/daily-orchestrator";
import { decayStalePreferences, recordSwap } from "@/lib/memory/preference";
import { getCandidateMeals, pickSwapMeal } from "@/lib/scenarios/weightloss/planner";
import { createTestUser, deleteTestUser } from "./helpers/db";

let user: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => { user = await createTestUser({ eatingMode: "cook" }); });
afterEach(async () => { if (user) await deleteTestUser(user.id); });
afterAll(async () => { await prisma.$disconnect(); });
const fishKey = () => `test_${user.id}_fish`;
const chickenKey = () => `test_${user.id}_chicken`;
async function publicMealTitles() {
  return (await prisma.meal.findMany({ where: { ownerId: null, mode: "cook", isActive: true }, select: { title: true } })).map(meal => meal.title);
}
async function morning() {
  await runMorning(user);
  return prisma.message.findFirstOrThrow({ where: { userId: user.id, require: "CONFIRM_OR_SWAP" } });
}

describe("retries and recovery preserve business evidence", () => {
  it("does not relax explicit exclusions or swap back to the current meal when candidates run out", async () => {
    const globalExclusions = await publicMealTitles();
    expect(await getCandidateMeals(user.id, [...globalExclusions, "鱼", "鸡肉"])).toEqual([]);
    await expect(pickSwapMeal(user.id, todayKey(), chickenKey(), [...globalExclusions, "鱼"])).rejects.toThrow();
    await prisma.meal.update({ where: { key: fishKey() }, data: { isActive: false } });
    await expect(pickSwapMeal(user.id, todayKey(), chickenKey(), globalExclusions)).rejects.toThrow();
  });

  it("decays elapsed weeks once while preserving explicitly confirmed preferences", async () => {
    const pref = await prisma.preferenceMemory.create({ data: { userId: user.id, key: `dislike:${fishKey()}`, category: "food", confidence: 0.8, source: "button_action", lastConfirmedAt: new Date("2026-01-01T00:00:00Z") } });
    await decayStalePreferences(user.id, new Date("2026-01-15T00:00:00Z"));
    await decayStalePreferences(user.id, new Date("2026-01-16T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.7);
    await decayStalePreferences(user.id, new Date("2026-01-22T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.6);
    await prisma.preferenceMemory.update({ where: { id: pref.id }, data: { source: "user_confirmed" } });
    await decayStalePreferences(user.id, new Date("2026-05-22T00:00:00Z"));
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.6);
  });

  it("replaying completion and check-in records one preference and one event per action", async () => {
    await runMorning(user);
    await runLunch(user);
    const lunch = await prisma.message.findFirstOrThrow({ where: { userId: user.id, type: "LUNCH" } });
    await respondToMessage(user.id, lunch.id, "complete");
    await respondToMessage(user.id, lunch.id, "complete");
    expect((await prisma.preferenceMemory.findFirstOrThrow({ where: { userId: user.id, key: { startsWith: "prefer:" } } })).evidenceCount).toBe(1);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "ACTION_COMPLETE" } })).toBe(1);
    await submitCheckin(user.id, 69);
    await submitCheckin(user.id, 69);
    expect(await prisma.checkIn.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "CHECKIN" } })).toBe(1);
  });

  it("replaying swap and attribution never swaps twice or repeatedly weakens a preference", async () => {
    const message = await morning();
    const before = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    await respondToMessage(user.id, message.id, "swap");
    await respondToMessage(user.id, message.id, "swap");
    expect((await prisma.dailyPlan.findUniqueOrThrow({ where: { id: before.id } })).mealKey).not.toBe(before.mealKey);
    const pref = await prisma.preferenceMemory.findUniqueOrThrow({ where: { userId_key: { userId: user.id, key: `dislike:${before.mealKey}` } } });
    expect(pref.evidenceCount).toBe(1);
    const ask = await prisma.message.findFirstOrThrow({ where: { userId: user.id, require: "ASK_USER" } });
    await expect(respondToAskUser(user.id, ask.id, "forged-option")).rejects.toThrow();
    await respondToAskUser(user.id, ask.id, "unavailable");
    await respondToAskUser(user.id, ask.id, "unavailable");
    expect((await prisma.preferenceMemory.findUniqueOrThrow({ where: { id: pref.id } })).confidence).toBeCloseTo(0.3);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "ASK_USER_RESPONDED" } })).toBe(1);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "ACTION_SWAP" } })).toBe(1);
  });

  it("resumes a partially committed swap without changing the replacement meal again", async () => {
    const message = await morning();
    const plan = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    const replacement = plan.mealKey === fishKey() ? chickenKey() : fishKey();
    await prisma.message.update({ where: { id: message.id }, data: { payload: JSON.stringify({ swapFrom: plan.mealKey }) } });
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { mealKey: replacement, status: "SWAPPED" } });
    await withUserOperation(user.id, `message:${message.id}:swap`, () => recordSwap(user.id, plan.mealKey!));
    await respondToMessage(user.id, message.id, "swap");
    expect((await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } })).mealKey).toBe(replacement);
    expect((await prisma.preferenceMemory.findFirstOrThrow({ where: { userId: user.id } })).evidenceCount).toBe(1);
  });

  it("rejects expired messages, invalid transitions and already-ended plans before memory writes", async () => {
    const message = await morning();
    await expect(respondToMessage(user.id, message.id, "complete")).rejects.toThrow();
    await prisma.dailyPlan.update({ where: { id: message.planId! }, data: { status: "COMPLETED" } });
    await expect(respondToMessage(user.id, message.id, "swap")).rejects.toThrow();
    await prisma.dailyPlan.update({ where: { id: message.planId! }, data: { status: "PENDING" } });
    await prisma.message.update({ where: { id: message.id }, data: { expiresAt: new Date(0) } });
    await expect(respondToMessage(user.id, message.id, "swap")).rejects.toThrow();
    expect(await prisma.preferenceMemory.count({ where: { userId: user.id } })).toBe(0);
  });

  it("delivers an actionable empty-candidate message without an invalid plan", async () => {
    await prisma.meal.updateMany({ where: { ownerId: user.id }, data: { isActive: false } });
    user.profile.dislikedFoods = JSON.stringify(await publicMealTitles());
    await prisma.userProfile.update({ where: { userId: user.id }, data: { dislikedFoods: user.profile.dislikedFoods } });
    await runMorning(user);
    const message = await prisma.message.findFirstOrThrow({ where: { userId: user.id } });
    expect(message.require).toBe("NONE");
    expect(message.text).toContain("没有符合忌口");
    expect(await prisma.dailyPlan.count({ where: { userId: user.id } })).toBe(0);
  });
});
