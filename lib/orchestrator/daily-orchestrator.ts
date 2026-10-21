import { prisma } from "@/lib/db";
import { todayKey, endOfToday } from "@/lib/date";
import { logEvent } from "@/lib/memory/episodic";
import { decayStalePreferences } from "@/lib/memory/preference";
import { getEngagementTrend } from "./engagement";
import { runAgentTurn } from "@/lib/agent/runner";
import { buildMorningGoal, buildLunchGoal, buildEveningGoal } from "@/lib/agent/prompts";
import { withUserOperation, writeTransaction } from "@/lib/operations";
import type { PersonaProfile, UserProfile } from "@/app/generated/prisma/client";

type FullUser = { id: string; profile: UserProfile; persona: PersonaProfile };
const dislikes = (user: FullUser): string[] => JSON.parse(user.profile.dislikedFoods || "[]");

async function delivered(userId: string, date: string, slot: string) {
  return prisma.message.findUnique({ where: { deliveryKey: `${userId}:${date}:${slot}` } });
}

export async function runMorning(user: FullUser) {
  const dateKey = todayKey();
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:morning`, async () => {
    const existing = await delivered(user.id, dateKey, "MORNING");
    if (existing) return { skipped: true, reason: "already_sent", planId: existing.planId, messageId: existing.id };
    await decayStalePreferences(user.id);
    const plan = await prisma.dailyPlan.findUnique({ where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } } });
    const trend = await getEngagementTrend(user.id);
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "morning", goal: buildMorningGoal({ trend, dateKey }), dateKey,
      explicitDislikedFoods: dislikes(user), fallbackPlanId: plan?.id,
    }) };
  });
}

export async function runLunch(user: FullUser) {
  const dateKey = todayKey();
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:lunch`, async () => {
    const existing = await delivered(user.id, dateKey, "LUNCH");
    if (existing) return { skipped: true, reason: "already_sent", messageId: existing.id };
    let plan = await prisma.dailyPlan.findUnique({ where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } } });
    if (!plan) {
      const morning = await runMorning(user);
      if ("status" in morning && morning.status === "failed") return morning;
      plan = await prisma.dailyPlan.findUnique({ where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } } });
    }
    if (!plan) return { skipped: true, reason: "no_eligible_plan" };
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "lunch", dateKey, explicitDislikedFoods: dislikes(user), fallbackPlanId: plan.id,
      goal: buildLunchGoal({
        dateKey, morningPlanId: plan.id, morningMealTitle: plan.mealTitle ?? "未定",
        morningStatus: plan.status, alreadyDecided: plan.status !== "PENDING",
      }),
    }) };
  });
}

export async function runEvening(user: FullUser) {
  const dateKey = todayKey();
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:evening`, async () => {
    const existing = await delivered(user.id, dateKey, "EVENING");
    if (existing) return { skipped: true, reason: "already_sent", messageId: existing.id };
    const { plan, outcome } = await writeTransaction(async (db) => {
      const morning = await db.dailyPlan.findUnique({ where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } } });
      let outcome: "COMPLETED" | "SKIPPED" | "NO_RESPONSE" | "OTHER" = "OTHER";
      if (morning) {
        if (["PENDING", "CONFIRMED", "SWAPPED", "AUTO_ACCEPTED", "NO_RESPONSE"].includes(morning.status)) {
          outcome = "NO_RESPONSE";
          await db.dailyPlan.update({ where: { id: morning.id }, data: { status: "NO_RESPONSE" } });
          await logEvent({ userId: user.id, eventType: "PLAN_NO_RESPONSE", planType: "MORNING", mealKey: morning.mealKey ?? undefined });
        } else if (morning.status === "COMPLETED" || morning.status === "SKIPPED") outcome = morning.status;
      }
      const plan = await db.dailyPlan.upsert({
        where: { userId_date_type: { userId: user.id, date: dateKey, type: "EVENING" } },
        create: { userId: user.id, date: dateKey, type: "EVENING", expiresAt: endOfToday() }, update: {},
      });
      return { plan, outcome };
    });
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "evening", dateKey, explicitDislikedFoods: dislikes(user), fallbackPlanId: plan.id,
      goal: buildEveningGoal({ dateKey, eveningPlanId: plan.id, morningOutcome: outcome }),
    }) };
  });
}
