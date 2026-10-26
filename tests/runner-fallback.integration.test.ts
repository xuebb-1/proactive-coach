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
  vi.stubEnv("AGENT_MODE", "real");
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  user = await createTestUser();
});

beforeEach(async () => {
  await prisma.message.deleteMany({ where: { userId: user.id } });
  await prisma.agentTrace.deleteMany({ where: { userId: user.id } });
  await prisma.episodicLog.deleteMany({ where: { userId: user.id } });
  await prisma.dailyPlan.deleteMany({ where: { userId: user.id } });
});

afterAll(async () => {
  vi.unstubAllEnvs();
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

    expect(result).toMatchObject({ status: "incomplete", delivery: "fallback" });
    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.finalMessageId! } });
    const plan = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: message.planId! } });
    expect(plan.mealKey).toBeTruthy();
    expect(message.require).toBe("CONFIRM_OR_SWAP");
    const trace = await prisma.agentTrace.findUniqueOrThrow({ where: { id: result.traceId } });
    expect(trace.status).toBe("INCOMPLETE");
    expect(trace.source).toBe("REAL");
    expect(trace.steps).toContain("model timeout");
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

  it("retains completed step evidence and usage when a later model step fails", async () => {
    vi.mocked(generateText).mockImplementationOnce(async options => {
      await options.onStepEnd?.({
        text: "先核对用户忌口",
        toolCalls: [], toolResults: [],
        usage: { inputTokens: 12, outputTokens: 3 },
        content: [{ type: "tool-error", toolName: "list_candidate_meals", error: new Error("temporary tool error") }],
      } as never);
      throw new Error("next step timeout");
    });
    const result = await runAgentTurn({
      userId: user.id, trigger: "morning", goal: "test partial evidence", dateKey: "2026-08-28",
      explicitDislikedFoods: [], dedupeKey: `test:${crypto.randomUUID()}`,
    });
    expect(result).toMatchObject({ status: "incomplete", delivery: "fallback" });
    const trace = await prisma.agentTrace.findUniqueOrThrow({ where: { id: result.traceId } });
    expect(trace).toMatchObject({ status: "INCOMPLETE", stepCount: 1, inputTokens: 12, outputTokens: 3, failureKind: "model_timeout" });
    expect(JSON.parse(trace.steps)).toEqual(expect.arrayContaining([
      { type: "model_text", text: "先核对用户忌口" },
      { type: "error", message: "list_candidate_meals: temporary tool error" },
      { type: "error", message: "next step timeout" },
    ]));
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
        expiresAt: new Date("2099-08-30T15:59:59.999Z"),
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
