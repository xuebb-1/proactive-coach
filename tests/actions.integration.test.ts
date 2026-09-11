import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { respondToMessage } from "@/lib/orchestrator/actions";
import { runLunch, runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { createTestUser, deleteTestUser } from "./helpers/db";

const createdUserIds: string[] = [];

async function fixtureWithMorning() {
  const user = await createTestUser();
  createdUserIds.push(user.id);
  if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");
  await runMorning({ id: user.id, profile: user.profile, persona: user.persona });
  const message = await prisma.message.findFirstOrThrow({
    where: { userId: user.id, type: "MORNING" },
    include: { plan: true },
  });
  return { user, message };
}

afterAll(async () => {
  for (const userId of createdUserIds) await deleteTestUser(userId);
  await prisma.$disconnect();
});

describe("message actions", () => {
  it("confirm uses only a deterministic trace", async () => {
    const { user, message } = await fixtureWithMorning();
    await respondToMessage(user.id, message.id, "confirm");

    const trace = await prisma.agentTrace.findFirstOrThrow({
      where: { userId: user.id, trigger: "confirm" },
    });
    expect(trace.source).toBe("DETERMINISTIC");
    expect((await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } })).status).toBe("CONFIRMED");
  });

  it.each(["complete", "skip"] as const)("%s uses only a deterministic trace", async (action) => {
    const { user } = await fixtureWithMorning();
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");
    await runLunch({ id: user.id, profile: user.profile, persona: user.persona });
    const lunch = await prisma.message.findFirstOrThrow({ where: { userId: user.id, type: "LUNCH" } });

    await respondToMessage(user.id, lunch.id, action);

    const trace = await prisma.agentTrace.findFirstOrThrow({ where: { userId: user.id, trigger: action } });
    expect(trace.source).toBe("DETERMINISTIC");
  });

  it("swap persists a different meal key", async () => {
    const { user, message } = await fixtureWithMorning();
    const oldMealKey = message.plan?.mealKey;

    await respondToMessage(user.id, message.id, "swap");

    const plan = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    expect(plan.mealKey).toBeTruthy();
    expect(plan.mealKey).not.toBe(oldMealKey);
    const trace = await prisma.agentTrace.findFirstOrThrow({ where: { userId: user.id, trigger: "swap" } });
    expect(trace.status).toBe("COMPLETE");
  });
});
