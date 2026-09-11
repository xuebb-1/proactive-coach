import { prisma } from "@/lib/db";

export async function createTestUser(overrides?: {
  eatingMode?: "cook" | "canteen" | "takeout";
  timezone?: string;
}) {
  return prisma.user.create({
    data: {
      clerkId: `test_${crypto.randomUUID()}`,
      profile: {
        create: {
          goalWeightKg: 65,
          currentWeightKg: 75,
          dislikedFoods: "[]",
          eatingMode: overrides?.eatingMode ?? "canteen",
          morningTime: "07:30",
          lunchTime: "12:00",
          eveningTime: "20:30",
          timezone: overrides?.timezone ?? "Asia/Shanghai",
        },
      },
      persona: {
        create: {
          tonePreference: "gentle",
          motivationHook: "health",
        },
      },
    },
    include: { profile: true, persona: true },
  });
}

export async function deleteTestUser(userId: string) {
  await prisma.$transaction([
    prisma.agentTrace.deleteMany({ where: { userId } }),
    prisma.message.deleteMany({ where: { userId } }),
    prisma.episodicLog.deleteMany({ where: { userId } }),
    prisma.preferenceMemory.deleteMany({ where: { userId } }),
    prisma.checkIn.deleteMany({ where: { userId } }),
    prisma.dailyPlan.deleteMany({ where: { userId } }),
    prisma.meal.deleteMany({ where: { ownerId: userId } }),
    prisma.userProfile.deleteMany({ where: { userId } }),
    prisma.personaProfile.deleteMany({ where: { userId } }),
    prisma.user.deleteMany({ where: { id: userId } }),
  ]);
}
