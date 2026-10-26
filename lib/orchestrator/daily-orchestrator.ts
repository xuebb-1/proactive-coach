import { prisma } from "@/lib/db";
import { endOfDayForTimeZone, todayKeyForTimeZone } from "@/lib/date";
import { decayStalePreferences } from "@/lib/memory/preference";
import { logEvent } from "@/lib/memory/episodic";
import { getEngagementTrend } from "./engagement";
import { runAgentTurn } from "@/lib/agent/runner";
import { getScenario } from "@/lib/scenarios/registry";
import { withUserOperation, writeTransaction } from "@/lib/operations";
import type { PersonaProfile, UserProfile } from "@/app/generated/prisma/client";

type FullUser = { id: string; profile: UserProfile; persona: PersonaProfile };
type Trigger = "morning" | "lunch" | "evening";

export type OrchestratorExecution = {
  now?: Date;
  dateKey?: string;
  dayEndsAt?: Date;
};

function executionFor(user: FullUser, execution?: OrchestratorExecution) {
  const now = execution?.now ?? new Date();
  return {
    now,
    dateKey: execution?.dateKey ?? todayKeyForTimeZone(user.profile.timezone, now),
    dayEndsAt: execution?.dayEndsAt ?? endOfDayForTimeZone(user.profile.timezone, now),
  };
}

function dedupeKey(userId: string, dateKey: string, trigger: Trigger) {
  return `agent-daily:${userId}:${dateKey}:${trigger}`;
}

const dislikes = (user: FullUser): string[] => JSON.parse(user.profile.dislikedFoods || "[]");

/** New deliveries use a slot key; retain recognition of pre-migration Beta keys. */
async function delivered(userId: string, dateKey: string, trigger: Trigger) {
  return prisma.message.findFirst({
    where: {
      userId,
      OR: [
        { deliveryKey: `${userId}:${dateKey}:${trigger.toUpperCase()}` },
        { dedupeKey: dedupeKey(userId, dateKey, trigger) },
      ],
    },
  });
}

export async function runMorning(user: FullUser, execution?: OrchestratorExecution) {
  const { now, dateKey, dayEndsAt } = executionFor(user, execution);
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:morning`, async () => {
    const existing = await delivered(user.id, dateKey, "morning");
    if (existing) return { skipped: true, reason: "already_generated", planId: existing.planId, messageId: existing.id };
    await decayStalePreferences(user.id, now);
    const plan = await prisma.dailyPlan.findUnique({
      where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
    });
    const trend = await getEngagementTrend(user.id, { timezone: user.profile.timezone, now });
    const scenario = getScenario(user.profile.scenarioId);
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "morning", goal: scenario.buildMorningGoal({ trend, dateKey }), dateKey,
      explicitDislikedFoods: dislikes(user), fallbackPlanId: plan?.id, dayEndsAt,
      dedupeKey: dedupeKey(user.id, dateKey, "morning"), scenarioId: scenario.id,
    }) };
  });
}

export async function runLunch(user: FullUser, execution?: OrchestratorExecution) {
  const resolved = executionFor(user, execution);
  const { dateKey, dayEndsAt } = resolved;
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:lunch`, async () => {
    const existing = await delivered(user.id, dateKey, "lunch");
    if (existing) return { skipped: true, reason: "already_sent", planId: existing.planId, messageId: existing.id };
    let plan = await prisma.dailyPlan.findUnique({
      where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
    });
    if (!plan) {
      // Missing-morning recovery keeps the queued user's original local day.
      const morning = await runMorning(user, resolved);
      if ("status" in morning && morning.status === "failed" && !morning.finalMessageId) return morning;
      plan = await prisma.dailyPlan.findUnique({
        where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
      });
    }
    if (!plan) return { skipped: true, reason: "no_eligible_plan" };
    const scenario = getScenario(user.profile.scenarioId);
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "lunch", dateKey, explicitDislikedFoods: dislikes(user), fallbackPlanId: plan.id,
      dayEndsAt, dedupeKey: dedupeKey(user.id, dateKey, "lunch"), scenarioId: scenario.id,
      goal: scenario.buildLunchGoal({
        dateKey, morningPlanId: plan.id, morningMealTitle: plan.mealTitle ?? "（未定）",
        morningStatus: plan.status, alreadyDecided: plan.status !== "PENDING",
      }),
    }) };
  });
}

export async function runEvening(user: FullUser, execution?: OrchestratorExecution) {
  const { dateKey, dayEndsAt } = executionFor(user, execution);
  return withUserOperation(user.id, `cron:${user.id}:${dateKey}:evening`, async () => {
    const existing = await delivered(user.id, dateKey, "evening");
    if (existing) return { skipped: true, reason: "already_sent", messageId: existing.id };
    const { plan, outcome } = await writeTransaction(async (db) => {
      const morning = await db.dailyPlan.findUnique({
        where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
      });
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
        create: { userId: user.id, date: dateKey, type: "EVENING", status: "PENDING", expiresAt: dayEndsAt }, update: {},
      });
      return { plan, outcome };
    });
    const scenario = getScenario(user.profile.scenarioId);
    return { skipped: false, ...await runAgentTurn({
      userId: user.id, trigger: "evening", dateKey, explicitDislikedFoods: dislikes(user), fallbackPlanId: plan.id,
      dayEndsAt, dedupeKey: dedupeKey(user.id, dateKey, "evening"), scenarioId: scenario.id,
      goal: scenario.buildEveningGoal({ dateKey, eveningPlanId: plan.id, morningOutcome: outcome }),
    }) };
  });
}
