import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/[type]/route";
import { getScheduledUser } from "@/lib/user";
import { runMorning } from "@/lib/orchestrator/daily-orchestrator";
import { OperationBusyError } from "@/lib/operations";

vi.mock("@/lib/user", () => ({ getScheduledUser: vi.fn() }));
vi.mock("@/lib/orchestrator/daily-orchestrator", () => ({
  runMorning: vi.fn(), runLunch: vi.fn(), runEvening: vi.fn(),
}));
const params = (type = "morning") => ({ params: Promise.resolve({ type }) });
const request = (secret = "test-cron") => new NextRequest("https://example.test/api/cron/morning", {
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron");
  vi.stubEnv("VERCEL", "1");
  vi.mocked(getScheduledUser).mockResolvedValue({ id: "test", profile: {}, persona: {} } as Awaited<ReturnType<typeof getScheduledUser>>);
});
afterEach(() => vi.unstubAllEnvs());

describe("scheduler health and authorization", () => {
  it("fails closed when a deployed scheduler has no secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(""), params())).status).toBe(503);
    expect(getScheduledUser).not.toHaveBeenCalled();
  });
  it("rejects unauthorized requests before reading personal data", async () => {
    expect((await GET(request("wrong"), params())).status).toBe(401);
    expect(getScheduledUser).not.toHaveBeenCalled();
  });
  it("rejects unknown triggers, including inherited object properties", async () => {
    expect((await GET(request(), params("constructor"))).status).toBe(400);
  });
  it("reports a failed agent turn as a failed HTTP request", async () => {
    vi.mocked(runMorning).mockResolvedValue({ skipped: false, status: "failed", traceId: "trace" });
    const response = await GET(request(), params());
    expect(response.status).toBe(503);
    expect((await response.json()).ok).toBe(false);
  });
  it("reports a delivered fallback as degraded success", async () => {
    vi.mocked(runMorning).mockResolvedValue({ skipped: false, status: "incomplete", traceId: "trace", finalMessageId: "message" });
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("incomplete");
  });
  it("asks overlapping callers to retry without starting another turn", async () => {
    vi.mocked(runMorning).mockRejectedValue(new OperationBusyError());
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("5");
  });
});
