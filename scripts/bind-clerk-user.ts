import { prisma } from "../lib/db";

async function main() {
  const [userId, clerkId] = process.argv.slice(2);
  if (!userId || !clerkId) {
    throw new Error("Usage: npm run bind:clerk-user -- <internal-user-id> <clerk-user-id>");
  }

  const [user, existingBinding] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.user.findUnique({ where: { clerkId } }),
  ]);
  if (!user) throw new Error(`Internal user not found: ${userId}`);
  if (user.clerkId && user.clerkId !== clerkId) {
    throw new Error(`User is already bound to ${user.clerkId}`);
  }
  if (existingBinding && existingBinding.id !== userId) {
    throw new Error(`Clerk account is already bound to internal user ${existingBinding.id}`);
  }

  const [, meals] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { clerkId } }),
    prisma.meal.updateMany({
      where: { source: "user", ownerId: null },
      data: { ownerId: userId },
    }),
  ]);
  console.log(`Bound internal user ${userId} to Clerk user ${clerkId}; assigned ${meals.count} legacy meals`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
