import { prisma } from "@/lib/db";

function requireIsolatedDatabase() {
  if (process.env.TEST_ISOLATED_DB !== "1") {
    throw new Error("Test fixtures require TEST_ISOLATED_DB=1 from npm test.");
  }
}

requireIsolatedDatabase();

export async function createTestUser(overrides?: {
  eatingMode?: "cook" | "canteen" | "takeout";
  timezone?: string;
  dislikedFoods?: string[];
  seedMeals?: boolean;
}) {
  requireIsolatedDatabase();
  const user = await prisma.user.create({
    data: {
      clerkId: `test_${crypto.randomUUID()}`,
      profile: {
        create: {
          goalWeightKg: 65,
          currentWeightKg: 75,
          dislikedFoods: JSON.stringify(overrides?.dislikedFoods ?? []),
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
  if (overrides?.seedMeals !== false) {
    await prisma.meal.createMany({ data: [
      { key: `test_${user.id}_fish`, title: "鱼肉饭", tags: ["鱼"], kcal: 500, mode: overrides?.eatingMode ?? "canteen", ownerId: user.id, source: "user" },
      { key: `test_${user.id}_chicken`, title: "鸡肉饭", tags: ["鸡肉"], kcal: 550, mode: overrides?.eatingMode ?? "canteen", ownerId: user.id, source: "user" },
    ] });
  }
  return { ...user, profile: user.profile!, persona: user.persona! };
}

export async function deleteTestUser(userId: string) {
  requireIsolatedDatabase();
  await prisma.$transaction([
    prisma.operationLease.deleteMany({ where: { key: `user:${userId}` } }),
    prisma.preferenceEvidence.deleteMany({ where: { key: { contains: userId } } }),
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
