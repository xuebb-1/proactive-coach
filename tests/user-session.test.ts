import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, getOrCreateCurrentUser, getOnboardedUserById } from "@/lib/user";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), create: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { user: {
  findUnique: mocks.findUnique, findFirst: mocks.findFirst, upsert: mocks.upsert, create: mocks.create,
} } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("beta user identity", () => {
  it("looks up each Clerk session by its own identity, never by the first user", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: "clerk-a" }).mockResolvedValueOnce({ userId: "clerk-b" });
    mocks.findUnique.mockResolvedValueOnce({ id: "a" }).mockResolvedValueOnce({ id: "b" });
    await expect(getCurrentUser()).resolves.toEqual({ id: "a" });
    await expect(getCurrentUser()).resolves.toEqual({ id: "b" });
    expect(mocks.findUnique.mock.calls.map(([input]) => input.where)).toEqual([{ clerkId: "clerk-a" }, { clerkId: "clerk-b" }]);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed in production when auth configuration or a session is missing", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(getOrCreateCurrentUser()).rejects.toThrow();
    expect(mocks.auth).not.toHaveBeenCalled();
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(getOrCreateCurrentUser()).rejects.toThrow();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("background lookup uses only the supplied user ID and requires complete onboarding", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "a", profile: null, persona: {} });
    await expect(getOnboardedUserById("a")).resolves.toBeNull();
    mocks.findUnique.mockResolvedValueOnce({ id: "b", profile: {}, persona: {} });
    await expect(getOnboardedUserById("b")).resolves.toMatchObject({ id: "b" });
    expect(mocks.findUnique.mock.calls.map(([input]) => input.where)).toEqual([{ id: "a" }, { id: "b" }]);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
