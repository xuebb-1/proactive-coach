import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { respondToMessage, submitCheckin } from "@/lib/orchestrator/actions";
import { createTestUser, deleteTestUser } from "./helpers/db";

const userIds: string[] = [];
async function fixture(timezone: string) {
  const user = await createTestUser({ timezone });
  userIds.push(user.id);
  return user;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const id of userIds.splice(0)) await deleteTestUser(id);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("local calendar days across the full persistence flow", () => {
  it("keeps plans, check-ins and attribution expiry on each user's own local day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-08-20T16:30:00Z");
    vi.setSystemTime(now);
    const shanghai = await fixture("Asia/Shanghai");
    const newYork = await fixture("America/New_York");
    for (const [user, date, expires] of [
      [shanghai, "2026-08-21", "2026-08-21T15:59:59.999Z"],
      [newYork, "2026-08-20", "2026-08-21T03:59:59.999Z"],
    ] as const) {
      await runMorning(user, { now });
      const plan = await prisma.dailyPlan.findFirstOrThrow({ where: { userId: user.id, type: "MORNING" } });
      expect(plan.date).toBe(date);
      expect(plan.expiresAt?.toISOString()).toBe(expires);
      const morning = await prisma.message.findFirstOrThrow({ where: { userId: user.id, type: "MORNING", require: "CONFIRM_OR_SWAP" } });
      expect(morning.expiresAt?.toISOString()).toBe(expires);
      await respondToMessage(user.id, morning.id, "swap");
      const attribution = await prisma.message.findFirstOrThrow({ where: { userId: user.id, require: "ASK_USER" } });
      expect(attribution.expiresAt?.toISOString()).toBe(expires);
      expect(attribution.deliveryKey).toBe(`${user.id}:${date}:ASK_USER`);
      await submitCheckin(user.id, 70);
      expect((await prisma.checkIn.findFirstOrThrow({ where: { userId: user.id } })).date).toBe(date);
    }
  });

  it("retries a queued pre-midnight turn without moving it to the processing date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-21T16:01:00Z")); // 00:01 on the next Shanghai day.
    const user = await fixture("Asia/Shanghai");
    const scheduled = {
      now: new Date("2026-08-21T15:59:00Z"),
      dateKey: "2026-08-21",
      dayEndsAt: new Date("2026-08-21T15:59:59.999Z"),
    };
    await runMorning(user, scheduled);
    await runMorning(user, scheduled);
    expect(await prisma.dailyPlan.findMany({ where: { userId: user.id }, select: { date: true } })).toEqual([{ date: "2026-08-21" }]);
    const messages = await prisma.message.findMany({ where: { userId: user.id, type: "MORNING" } });
    expect(messages).toHaveLength(1);
    expect(messages[0].deliveryKey).toBe(`${user.id}:2026-08-21:MORNING`);
    expect(messages[0].expiresAt).toEqual(scheduled.dayEndsAt);
  });
});
