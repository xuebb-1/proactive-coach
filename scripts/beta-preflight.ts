import { prisma } from "../lib/db";

async function main() {
  const [checkInDuplicates, usersWithoutClerk, unownedUserMeals] = await Promise.all([
    prisma.$queryRaw<Array<{ userId: string; date: string; count: bigint }>>`
      SELECT "userId", "date", COUNT(*) AS count
      FROM "CheckIn"
      GROUP BY "userId", "date"
      HAVING COUNT(*) > 1
    `,
    prisma.user.count({ where: { clerkId: null } }),
    prisma.meal.count({ where: { source: "user", ownerId: null } }),
  ]);

  const failures = [
    checkInDuplicates.length > 0 && `${checkInDuplicates.length} duplicate CheckIn keys`,
    usersWithoutClerk > 0 && `${usersWithoutClerk} users without Clerk binding`,
    unownedUserMeals > 0 && `${unownedUserMeals} user meals without an owner`,
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Beta preflight failed: ${failures.join("; ")}`);
  }

  console.log("Beta preflight passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
