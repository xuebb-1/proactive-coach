import { prisma } from "@/lib/db";
import { requireOwnerSession } from "@/lib/auth";

/**
 * Single-owner application: browser access requires an owner session.
 * There is at most one User row. This helper centralizes that assumption so
 * it's a one-line change later if multi-user support is ever needed.
 */
export async function getCurrentUser() {
  await requireOwnerSession();
  return getScheduledUser();
}

/** Scheduler-only data access. The route must authenticate CRON_SECRET first. */
export async function getScheduledUser() {
  return prisma.user.findFirst({
    include: { profile: true, persona: true },
  });
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user || !user.profile || !user.persona) {
    throw new Error("No onboarded user found. Complete /onboarding first.");
  }
  return user as typeof user & {
    profile: NonNullable<typeof user.profile>;
    persona: NonNullable<typeof user.persona>;
  };
}
