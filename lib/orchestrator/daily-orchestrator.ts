import { prisma } from "@/lib/db";
import { todayKey, endOfToday } from "@/lib/date";
import { decayStalePreferences } from "@/lib/memory/preference";
import { logEvent } from "@/lib/memory/episodic";
import { getEngagementTrend } from "./engagement";
import { runAgentTurn } from "@/lib/agent/runner";
import { buildMorningGoal, buildLunchGoal, buildEveningGoal } from "@/lib/agent/prompts";
import type { PersonaProfile, UserProfile } from "@/app/generated/prisma/client";

type FullUser = {
  id: string;
  profile: UserProfile;
  persona: PersonaProfile;
};

function explicitDislikesOf(user: FullUser): string[] {
  return JSON.parse(user.profile.dislikedFoods || "[]");
}

/**
 * 07:30 trigger: an Agent turn plans today's lunch and sends the
 * confirm/swap message. Idempotency is keyed on the MORNING *message*, not
 * the plan -- if create_daily_plan succeeded but the model then failed
 * before send_proactive_message, the plan already existing must NOT
 * permanently silence today (see plan §护栏与失败处理).
 */
export async function runMorning(user: FullUser) {
  const dateKey = todayKey();
  await decayStalePreferences(user.id);

  const plan = await prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
  });
  const existingMessage = plan
    ? await prisma.message.findFirst({ where: { planId: plan.id, type: "MORNING" } })
    : null;
  if (existingMessage) {
    return { skipped: true, reason: "already_generated", planId: plan!.id, messageId: existingMessage.id };
  }

  const trend = await getEngagementTrend(user.id);
  const goal = buildMorningGoal({ trend, dateKey });

  const result = await runAgentTurn({
    userId: user.id,
    trigger: "morning",
    goal,
    dateKey,
    explicitDislikedFoods: explicitDislikesOf(user),
    fallbackPlanId: plan?.id,
  });

  return { skipped: false, ...result };
}

/** 12:00 trigger: nudge about the meal plan. Falls back to generating one if morning was missed. */
export async function runLunch(user: FullUser) {
  const dateKey = todayKey();

  let plan = await prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
  });
  if (!plan) {
    const morningResult = await runMorning(user);
    if (morningResult.planId) {
      plan = await prisma.dailyPlan.findUnique({ where: { id: morningResult.planId } });
    }
  }
  if (!plan) return { skipped: true, reason: "no_plan" as const };

  const existingLunchMsg = await prisma.message.findFirst({
    where: { userId: user.id, planId: plan.id, type: "LUNCH" },
  });
  if (existingLunchMsg) return { skipped: true, reason: "already_sent" as const, planId: plan.id, messageId: existingLunchMsg.id };

  const alreadyDecided = plan.status === "CONFIRMED" || plan.status === "SWAPPED";
  const goal = buildLunchGoal({
    dateKey,
    morningPlanId: plan.id,
    morningMealTitle: plan.mealTitle ?? "（未定）",
    morningStatus: plan.status,
    alreadyDecided,
  });

  const result = await runAgentTurn({
    userId: user.id,
    trigger: "lunch",
    goal,
    dateKey,
    explicitDislikedFoods: explicitDislikesOf(user),
    fallbackPlanId: plan.id,
  });

  return { skipped: false, ...result };
}

/** 20:30 trigger: auto-resolve unanswered plans, then ask for a weight check-in. */
export async function runEvening(user: FullUser) {
  const dateKey = todayKey();

  const morningPlan = await prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
  });

  let outcome: "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" | "OTHER" = "OTHER";
  if (morningPlan) {
    if (morningPlan.status === "PENDING" || morningPlan.status === "CONFIRMED" || morningPlan.status === "SWAPPED") {
      // Not explicitly completed/skipped by the user -- the day is ending,
      // so resolve it deterministically rather than leaving it dangling.
      // This is a fixed business rule, not a judgment call -- no Agent turn needed here.
      if (morningPlan.status === "PENDING") {
        await logEvent({ userId: user.id, eventType: "AUTO_ACCEPTED", planType: "MORNING", mealKey: morningPlan.mealKey ?? undefined });
      }
      await prisma.dailyPlan.update({ where: { id: morningPlan.id }, data: { status: "AUTO_ACCEPTED" } });
      outcome = "AUTO_ACCEPTED";
    } else if (morningPlan.status === "COMPLETED") {
      outcome = "COMPLETED";
    } else if (morningPlan.status === "SKIPPED") {
      outcome = "SKIPPED";
    }
  }

  // Idempotent on the EVENING *message*, not the plan -- same reasoning as runMorning.
  const existingEveningMessage = await prisma.message.findFirst({
    where: { userId: user.id, type: "EVENING", plan: { date: dateKey, type: "EVENING" } },
  });
  if (existingEveningMessage) {
    return { skipped: true, reason: "already_sent" as const, messageId: existingEveningMessage.id };
  }

  const eveningPlan = await prisma.dailyPlan.upsert({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "EVENING" } },
    create: { userId: user.id, date: dateKey, type: "EVENING", status: "PENDING", expiresAt: endOfToday() },
    update: {},
  });

  const goal = buildEveningGoal({ dateKey, eveningPlanId: eveningPlan.id, morningOutcome: outcome });

  const result = await runAgentTurn({
    userId: user.id,
    trigger: "evening",
    goal,
    dateKey,
    explicitDislikedFoods: explicitDislikesOf(user),
    fallbackPlanId: eveningPlan.id,
  });

  return { skipped: false, ...result };
}
