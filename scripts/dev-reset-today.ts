/**
 * Dev helper: wipe today's plans/messages/traces so a demo or e2e test can
 * re-run the full morning -> lunch -> evening cycle from scratch.
 * Usage: npx tsx scripts/dev-reset-today.ts
 */
import { prisma } from "../lib/db";
import { todayKey } from "../lib/date";

async function main() {
  const dateKey = todayKey();
  const plans = await prisma.dailyPlan.findMany({ where: { date: dateKey }, select: { id: true } });
  const planIds = plans.map((p) => p.id);

  const startOfDay = new Date(`${dateKey}T00:00:00+08:00`);
  const messages = await prisma.message.deleteMany({
    where: { OR: [{ planId: { in: planIds } }, { createdAt: { gte: startOfDay } }] },
  });
  const traces = await prisma.agentTrace.deleteMany({ where: { createdAt: { gte: startOfDay } } });
  const deletedPlans = await prisma.dailyPlan.deleteMany({ where: { date: dateKey } });
  const checkins = await prisma.checkIn.deleteMany({ where: { date: dateKey } });

  console.log(
    `reset ${dateKey}: plans=${deletedPlans.count} messages=${messages.count} traces=${traces.count} checkins=${checkins.count}`
  );
}

main().finally(() => prisma.$disconnect());
