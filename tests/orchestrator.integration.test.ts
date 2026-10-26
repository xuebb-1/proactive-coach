import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runEvening, runLunch, runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { createTestUser, deleteTestUser } from "./helpers/db";

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  user = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(user.id);
  await prisma.$disconnect();
});

describe("daily orchestrator in mock mode", () => {
  it("creates one morning plan/message/trace and is idempotent", async () => {
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");

    const first = await runMorning({ id: user.id, profile: user.profile, persona: user.persona });
    expect(first.skipped).toBe(false);

    const messages = await prisma.message.findMany({ where: { userId: user.id, type: "MORNING" } });
    const traces = await prisma.agentTrace.findMany({ where: { userId: user.id, trigger: "morning" } });
    expect(messages).toHaveLength(1);
    expect(messages[0].planId).toBeTruthy();
    expect(traces).toHaveLength(1);
    expect(traces[0].source).toBe("MOCK");

    const second = await runMorning({ id: user.id, profile: user.profile, persona: user.persona });
    expect(second).toMatchObject({ skipped: true });
    expect(await prisma.message.count({ where: { userId: user.id, type: "MORNING" } })).toBe(1);
  });

  it("reuses the morning plan for lunch", async () => {
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");

    await runLunch({ id: user.id, profile: user.profile, persona: user.persona });

    expect(await prisma.dailyPlan.count({ where: { userId: user.id, type: "LUNCH" } })).toBe(0);
    const lunch = await prisma.message.findFirst({ where: { userId: user.id, type: "LUNCH" } });
    const morning = await prisma.dailyPlan.findFirst({ where: { userId: user.id, type: "MORNING" } });
    expect(lunch?.planId).toBe(morning?.id);
  });

  it("keeps an unreported morning plan unknown in the evening", async () => {
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");

    await runEvening({ id: user.id, profile: user.profile, persona: user.persona });

    const morning = await prisma.dailyPlan.findFirst({ where: { userId: user.id, type: "MORNING" } });
    expect(morning?.status).toBe("NO_RESPONSE");
    expect(await prisma.message.count({ where: { userId: user.id, type: "EVENING" } })).toBe(1);
    expect(await prisma.preferenceMemory.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.episodicLog.count({ where: { userId: user.id, eventType: "ACTION_COMPLETE" } })).toBe(0);
  });
});
