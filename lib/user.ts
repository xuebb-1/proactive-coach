import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

export function isClerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export async function getCurrentUser() {
  if (!isClerkConfigured()) {
    if (process.env.NODE_ENV === "production") return null;
    return prisma.user.findFirst({ include: { profile: true, persona: true } });
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  return prisma.user.findUnique({
    where: { clerkId },
    include: { profile: true, persona: true },
  });
}

export const getCurrentUserFromSession = getCurrentUser;

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

/** Web-only identity creation. Background workers must use getOnboardedUserById. */
export async function getOrCreateCurrentUser() {
  if (!isClerkConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Clerk is not configured");
    return (await prisma.user.findFirst()) ?? prisma.user.create({ data: {} });
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthenticated");
  return prisma.user.upsert({
    where: { clerkId },
    create: { clerkId },
    update: {},
  });
}

export async function getOnboardedUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, persona: true },
  });
  if (!user?.profile || !user.persona) return null;
  return user as typeof user & {
    profile: NonNullable<typeof user.profile>;
    persona: NonNullable<typeof user.persona>;
  };
}

export async function listOnboardedUsers() {
  const users = await prisma.user.findMany({
    where: { profile: { isNot: null }, persona: { isNot: null } },
    include: { profile: true, persona: true },
  });
  return users.filter(
    (user): user is typeof user & {
      profile: NonNullable<typeof user.profile>;
      persona: NonNullable<typeof user.persona>;
    } => Boolean(user.profile && user.persona)
  );
}
