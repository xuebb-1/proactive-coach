import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { createTestUser, deleteTestUser } from "./helpers/db";

const enabled = process.env.RUN_REAL_MODEL_SMOKE === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
let user: Awaited<ReturnType<typeof createTestUser>>;

describe.skipIf(!enabled)("real model smoke", () => {
  beforeAll(async () => {
    process.env.AGENT_MODE = "real";
    user = await createTestUser();
  });

  afterAll(async () => {
    await deleteTestUser(user.id);
    await prisma.$disconnect();
  });

  it("delivers one valid morning plan and message", async () => {
    if (!user.profile || !user.persona) throw new Error("fixture user is not onboarded");
    const result = await runMorning({ id: user.id, profile: user.profile, persona: user.persona });
    expect(result.skipped).toBe(false);
    if (!("finalMessageId" in result)) throw new Error(`Morning was skipped: ${result.reason}`);
    expect(result.finalMessageId).toBeTruthy();
    expect(result.planId).toBeTruthy();
  });
});
