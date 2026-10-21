import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, validSession, validPassword } from "@/lib/auth-session";

afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("ADMIN_PASSWORD", "test-only-owner-password");
  vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-characters");
}

describe("owner access", () => {
  it("denies access when credentials are absent or too short", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    vi.stubEnv("SESSION_SECRET", "");
    expect(validSession("anything")).toBe(false);
    expect(validPassword("")).toBe(false);
    expect(() => createSession()).toThrow();
  });
  it("rejects forged, expired and revoked cookies", () => {
    configure();
    const now = Date.now();
    const session = createSession(now);
    expect(validSession(session, now)).toBe(true);
    expect(validSession(session + "tampered", now)).toBe(false);
    expect(validSession(session, now + 8 * 86400000)).toBe(false);
    vi.stubEnv("ADMIN_PASSWORD", "another-owner-password");
    expect(validSession(session, now)).toBe(false);
  });
  it("accepts only the configured owner password", () => {
    configure();
    expect(validPassword("test-only-owner-password")).toBe(true);
    expect(validPassword("wrong")).toBe(false);
  });
});
