import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { runActionTurn, runAgentTurn } from "@/lib/agent/runner";
import { createTestUser, deleteTestUser } from "./helpers/db";

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  process.env.AGENT_MODE = "real";
  process.env.DEEPSEEK_API_KEY = "test-key";
  user = await createTestUser();
});

beforeEach(async () => {
  await prisma.message.deleteMany({ where: { userId: user.id } });
  await prisma.agentTrace.deleteMany({ where: { userId: user.id } });
  await prisma.episodicLog.deleteMany({ where: { userId: user.id } });
  await prisma.dailyPlan.deleteMany({ where: { userId: user.id } });
});

afterAll(async () => {
  process.env.AGENT_MODE = "mock";
  delete process.env.DEEPSEEK_API_KEY;
  await deleteTestUser(user.id);
  await prisma.$disconnect();
});

describe("cron fallback delivery", () => {
  it("creates a legal plan and message when the model throws", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("model timeout"));

    const result = await runAgentTurn({
      userId: user.id,
      trigger: "morning",
      goal: "test",
      dateKey: "2026-08-28",
      explicitDislikedFoods: [],
      dedupeKey: `test:${crypto.randomUUID()}`,
    });

    expect(result).toMatchObject({ status: "failed", delivery: "fallback" });
    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.finalMessageId! } });
    const plan = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    expect(plan.mealKey).toBeTruthy();
    expect(message.require).toBe("CONFIRM_OR_SWAP");
  });

  it("falls back when the model ends without a final message", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ steps: [], usage: {} } as never);

    const result = await runAgentTurn({
      userId: user.id,
      trigger: "morning",
      goal: "test",
      dateKey: "2026-08-29",
      explicitDislikedFoods: [],
      dedupeKey: `test:${crypto.randomUUID()}`,
    });

    expect(result).toMatchObject({ status: "incomplete", delivery: "fallback" });
    expect(await prisma.message.count({ where: { userId: user.id } })).toBe(1);
  });

  it("marks swap incomplete when the persisted meal key did not change", async () => {
    const plan = await prisma.dailyPlan.create({
      data: {
        userId: user.id,
        date: "2026-08-30",
        type: "MORNING",
        mealKey: "unchanged",
        mealTitle: "unchanged",
        status: "PENDING",
        expiresAt: new Date("2026-08-30T15:59:59.999Z"),
      },
    });
    vi.mocked(generateText).mockResolvedValueOnce({ steps: [], usage: {} } as never);

    const result = await runActionTurn({
      userId: user.id,
      trigger: "swap",
      goal: "test",
      dateKey: plan.date,
      explicitDislikedFoods: [],
      planId: plan.id,
      previousMealKey: "unchanged",
    });

    expect(result.status).toBe("incomplete");
    expect((await prisma.agentTrace.findUniqueOrThrow({ where: { id: result.traceId } })).status).toBe("INCOMPLETE");
  });
});
