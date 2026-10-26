import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCandidateMeals } from "@/lib/scenarios/weightloss/planner";
import { respondToAskUser, respondToMessage } from "@/lib/orchestrator/actions";
import { createToolCtx } from "@/lib/agent/tools/context";
import { planningImpls } from "@/lib/agent/tools/planning";
import { messagingImpls } from "@/lib/agent/tools/messaging";
import { createTestUser, deleteTestUser } from "./helpers/db";

let userA: Awaited<ReturnType<typeof createTestUser>>;
let userB: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  userA = await createTestUser();
  userB = await createTestUser();
  await prisma.meal.createMany({
    data: [
      { key: `private_${userA.id}`, title: "A 私有菜", kcal: 500, tags: [], mode: "canteen", source: "user", ownerId: userA.id },
      { key: `private_${userB.id}`, title: "B 私有菜", kcal: 500, tags: [], mode: "canteen", source: "user", ownerId: userB.id },
    ],
  });
});

afterAll(async () => {
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("candidate meals include platform seed and own private meals only", async () => {
    const candidates = await getCandidateMeals(userA.id, []);
    const keys = candidates.map((meal) => meal.key);
    expect(keys).toContain(`private_${userA.id}`);
    expect(keys).not.toContain(`private_${userB.id}`);
  });

  it("rejects another user's message, feedback and tool plan without creating side effects", async () => {
    const plan = await prisma.dailyPlan.create({ data: { userId: userA.id, date: "2099-01-01", type: "MORNING", mealKey: `private_${userA.id}` } });
    const message = await prisma.message.create({ data: { userId: userA.id, planId: plan.id, type: "MORNING", text: "A only", require: "CONFIRM_OR_SWAP", payload: "{}", expiresAt: new Date("2099-01-02T00:00:00Z") } });
    const ask = await prisma.message.create({ data: { userId: userA.id, planId: plan.id, type: "MORNING", text: "A feedback", require: "ASK_USER", payload: JSON.stringify({ kind: "swap_attribution", mealKey: `private_${userA.id}`, options: [{ value: "dislike", label: "不喜欢" }] }), expiresAt: new Date("2099-01-02T00:00:00Z") } });
    const ctx = createToolCtx(userB.id, "2099-01-01");
    ctx.trigger = "swap";
    ctx.swapMealKey = `private_${userA.id}`;
    ctx.finalPlanId = plan.id;
    ctx.lastCandidateKeys = new Set([`private_${userB.id}`]);
    await expect(respondToMessage(userB.id, message.id, "confirm")).rejects.toThrow();
    await expect(respondToAskUser(userB.id, ask.id, "dislike")).rejects.toThrow();
    await expect(planningImpls.updateDailyPlan(ctx, { planId: plan.id, mealKey: `private_${userB.id}`, status: "SWAPPED" })).rejects.toThrow();
    await expect(messagingImpls.sendProactiveMessage(ctx, { planId: plan.id, type: "MORNING", text: "forged", require: "NONE" })).rejects.toThrow();
    expect(await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ userId: userA.id, mealKey: `private_${userA.id}`, status: "PENDING" });
    expect(await prisma.message.count({ where: { userId: userB.id } })).toBe(0);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).respondedAt).toBeNull();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: ask.id } })).respondedAt).toBeNull();
    for (const userId of [userA.id, userB.id]) {
      expect(await prisma.preferenceMemory.count({ where: { userId } })).toBe(0);
      expect(await prisma.episodicLog.count({ where: { userId } })).toBe(0);
      expect(await prisma.agentTrace.count({ where: { userId } })).toBe(0);
    }
  });
});
