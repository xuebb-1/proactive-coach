import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationBusyError } from "@/lib/operations";
import { GET } from "@/app/api/cron/[type]/route";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), byId: vi.fn(), morning: vi.fn(), lunch: vi.fn(), evening: vi.fn(),
}));
vi.mock("@/lib/user", () => ({ getCurrentUser: mocks.currentUser, getOnboardedUserById: mocks.byId }));
vi.mock("@/lib/orchestrator/daily-orchestrator", () => ({ runMorning: mocks.morning, runLunch: mocks.lunch, runEvening: mocks.evening }));

const sessionUser = { id: "session-user", profile: { timezone: "Asia/Shanghai" }, persona: { name: "coach" } };
const explicitUser = { ...sessionUser, id: "background-user" };
function request(type = "morning", options: { userId?: string; bearer?: string } = {}) {
  const url = new URL(`https://test.invalid/api/cron/${type}`);
  if (options.userId !== undefined) url.searchParams.set("userId", options.userId);
  const headers = options.bearer ? { authorization: `Bearer ${options.bearer}` } : undefined;
  return GET(new NextRequest(url, { headers }), { params: Promise.resolve({ type }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("CRON_SECRET", "");
  mocks.currentUser.mockResolvedValue(sessionUser);
  mocks.byId.mockResolvedValue(explicitUser);
  mocks.morning.mockResolvedValue({ status: "completed", finalMessageId: "message" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("cron authentication and retry responses", () => {
  it.each(["production", "vercel"])("fails closed without a secret in %s", async deployment => {
    if (deployment === "production") vi.stubEnv("NODE_ENV", "production");
    else vi.stubEnv("VERCEL", "1");
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cron_not_configured" });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.morning).not.toHaveBeenCalled();
  });

  it("requires the configured bearer before selecting any user", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    expect((await request("morning", { bearer: "wrong", userId: "background-user" })).status).toBe(401);
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect((await request("morning", { bearer: "test-cron-secret", userId: "background-user" })).status).toBe(200);
    expect(mocks.byId).toHaveBeenCalledExactlyOnceWith("background-user");
    expect(mocks.morning).toHaveBeenCalledExactlyOnceWith(explicitUser);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("limits a local request without a secret to its current session", async () => {
    expect((await request("morning", { userId: "background-user" })).status).toBe(401);
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect((await request()).status).toBe(200);
    expect(mocks.currentUser).toHaveBeenCalledTimes(1);
    expect(mocks.morning).toHaveBeenCalledExactlyOnceWith(sessionUser);
  });

  it("rejects an inherited constructor trigger without looking up a user", async () => {
    expect((await request("constructor")).status).toBe(400);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("marks an active lease as retryable and never leaks its error", async () => {
    mocks.morning.mockRejectedValue(new OperationBusyError());
    const response = await request();
    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toMatchObject({ error: "operation_in_progress" });
  });

  it("returns a retryable failure until a final message exists", async () => {
    mocks.morning.mockResolvedValueOnce({ status: "failed" });
    expect((await request()).status).toBe(503);
    mocks.morning.mockResolvedValueOnce({ status: "incomplete", delivery: "fallback", finalMessageId: "fallback-message" });
    const delivered = await request();
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({ ok: true, result: { status: "incomplete", finalMessageId: "fallback-message" } });
  });
});
