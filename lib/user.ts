import { prisma } from "@/lib/db";

/**
 * v1 is a single-user personal project: no auth, no multi-tenant concerns.
 * There is at most one User row. This helper centralizes that assumption so
 * it's a one-line change later if multi-user support is ever needed.
 */
export async function getCurrentUser() {
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
