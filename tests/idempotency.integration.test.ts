import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { OperationBusyError } from "@/lib/operations";
import { createTestUser, deleteTestUser } from "./helpers/db";

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  user = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(user.id);
  await prisma.$disconnect();
});

describe("three-layer idempotency", () => {
  it("concurrent morning deliveries persist one plan and one feed message", async () => {
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");
    const input = { id: user.id, profile: user.profile, persona: user.persona };

    const outcomes = await Promise.allSettled([runMorning(input), runMorning(input)]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(OperationBusyError);
    }
    // A caller that receives busy may retry after the active operation finishes.
    await runMorning(input);

    expect(await prisma.dailyPlan.count({ where: { userId: user.id, type: "MORNING" } })).toBe(1);
    expect(await prisma.message.count({ where: { userId: user.id, type: "MORNING" } })).toBe(1);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "PLAN_GENERATED" } })).toBe(1);
  });
});
