import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "coach_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function authConfigured() {
  return (process.env.ADMIN_PASSWORD?.length ?? 0) >= 16 && (process.env.SESSION_SECRET?.length ?? 0) >= 32;
}

function signature(value: string) {
  // Changing either credential revokes existing sessions.
  return createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(`${value}:${process.env.ADMIN_PASSWORD}`).digest("base64url");
}

function equal(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function validPassword(password: string) {
  return authConfigured() && equal(password, process.env.ADMIN_PASSWORD!);
}

export function createSession(now = Date.now()) {
  if (!authConfigured()) throw new Error("Owner authentication is not configured");
  const expiry = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${expiry}.${signature(expiry)}`;
}

export function validSession(value?: string, now = Date.now()) {
  if (!authConfigured() || !value || value.length > 128) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [expiry, mac] = parts;
  const seconds = Number(expiry);
  return /^\d+$/.test(expiry) && Number.isSafeInteger(seconds) &&
    seconds > Math.floor(now / 1000) && seconds <= Math.floor(now / 1000) + SESSION_SECONDS &&
    !!mac && equal(mac, signature(expiry));
}
