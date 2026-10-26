import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/inngest/functions/agent-trigger";

interface EventData {
  userId: string; trigger: "morning" | "lunch" | "evening";
  dateKey: string; scheduledAt: string; dedupeKey: string;
}
type Handler = (args: {
  event: { data: EventData };
  step: { run: (name: string, callback: () => Promise<unknown>) => Promise<unknown> };
}) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  byId: vi.fn(), morning: vi.fn(), lunch: vi.fn(), evening: vi.fn(), capture: vi.fn(),
  handler: undefined as Handler | undefined,
}));
vi.mock("@/lib/user", () => ({ getOnboardedUserById: mocks.byId }));
vi.mock("@/lib/orchestrator/daily-orchestrator", () => ({ runMorning: mocks.morning, runLunch: mocks.lunch, runEvening: mocks.evening }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.capture }));
vi.mock("@/lib/inngest/events", () => ({ dailyAgentEvent: {} }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_config: unknown, handler: Handler) => { mocks.handler = handler; return {}; } } }));

const user = { id: "scheduled-user", profile: { timezone: "Asia/Shanghai" }, persona: {} };
const data: EventData = {
  userId: user.id, trigger: "morning", dateKey: "2026-08-20",
  scheduledAt: "2026-08-20T15:59:00.000Z", dedupeKey: "agent-daily:scheduled-user:2026-08-20:morning",
};
function execute(overrides: Partial<EventData> = {}) {
  if (!mocks.handler) throw new Error("Queue handler was not registered");
  return mocks.handler({ event: { data: { ...data, ...overrides } }, step: { run: async (_name, callback) => callback() } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.byId.mockResolvedValue(user);
  mocks.morning.mockResolvedValue({ status: "completed", finalMessageId: "message" });
});
afterEach(() => { vi.useRealTimers(); });

describe("queued agent execution", () => {
  it("keeps the user's scheduled day and expiry when retrying after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-21T16:10:00.000Z"));
    await execute();
    await execute();
    expect(mocks.byId).toHaveBeenNthCalledWith(1, user.id);
    expect(mocks.byId).toHaveBeenNthCalledWith(2, user.id);
    const expected = {
      now: new Date(data.scheduledAt), dateKey: "2026-08-20",
      dayEndsAt: new Date("2026-08-20T15:59:59.999Z"),
    };
    expect(mocks.morning).toHaveBeenNthCalledWith(1, user, expected);
    expect(mocks.morning).toHaveBeenNthCalledWith(2, user, expected);
  });

  it("throws an undelivered failure for queue retry but accepts a delivered fallback", async () => {
    mocks.morning.mockResolvedValueOnce({ status: "failed" });
    await expect(execute()).rejects.toThrow("before delivery");
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    mocks.morning.mockResolvedValueOnce({ status: "incomplete", delivery: "fallback", finalMessageId: "fallback" });
    await expect(execute()).resolves.toMatchObject({ status: "incomplete", finalMessageId: "fallback" });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it("skips an unknown or incomplete user before invoking an agent", async () => {
    mocks.byId.mockResolvedValueOnce(null);
    await expect(execute({ userId: "missing-user" })).resolves.toMatchObject({ skipped: true });
    expect(mocks.byId).toHaveBeenCalledExactlyOnceWith("missing-user");
    expect(mocks.morning).not.toHaveBeenCalled();
  });
});
