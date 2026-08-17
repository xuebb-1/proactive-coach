import { prisma } from "@/lib/db";
import {
  recordCompletion,
  recordSwap,
  confirmDislike,
  revertSwapSignal,
  DISLIKE_THRESHOLD,
} from "@/lib/memory/preference";
import { logEvent } from "@/lib/memory/episodic";
import { todayKey } from "@/lib/date";
import { runActionTurn, saveTrivialActionTrace } from "@/lib/agent/runner";
import { buildSwapGoal } from "@/lib/agent/prompts";
import { pickSwapMeal } from "@/lib/scenarios/weightloss/planner";
import { messagingImpls } from "@/lib/agent/tools/messaging";
import { createToolCtx } from "@/lib/agent/tools/context";

export type ButtonAction = "confirm" | "swap" | "complete" | "skip";

/**
 * Single entry point for every button click in the Today Card.
 *
 * Only `swap` goes through the Agent (`runActionTurn`) -- it's the one
 * button with real judgment space (picking among candidates). confirm /
 * complete / skip are unambiguous state transitions; routing those through
 * an LLM call would only add latency/cost/uncertainty with zero upside, so
 * they stay exactly as deterministic as before. Each still records a
 * trivial DETERMINISTIC trace so the /trace timeline doesn't have gaps.
 */
export async function respondToMessage(userId: string, messageId: string, action: ButtonAction) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { plan: true },
  });
  if (!message || message.userId !== userId) throw new Error("Message not found");
  if (!message.plan) throw new Error("Message has no associated plan");

  const plan = message.plan;

  if (action === "confirm") {
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { status: "CONFIRMED" } });
    await logEvent({ userId, eventType: "ACTION_CONFIRM", planType: "MORNING", mealKey: plan.mealKey ?? undefined });
    await saveTrivialActionTrace({ userId, trigger: "confirm", goal: "用户点击确认，无歧义状态转移。", planId: plan.id });
  } else if (action === "swap") {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    const explicitDislikes: string[] = JSON.parse(profile?.dislikedFoods || "[]");
    const oldMealKey = plan.mealKey ?? "";
    const dateKey = todayKey();

    const goal = buildSwapGoal({
      dateKey,
      planId: plan.id,
      oldMealKey,
      oldMealTitle: plan.mealTitle ?? "（未知）",
    });

    const result = await runActionTurn({
      userId,
      trigger: "swap",
      goal,
      dateKey,
      explicitDislikedFoods: explicitDislikes,
      planId: plan.id,
    });

    // The Agent turn can fail or finish without actually changing the meal.
    // The user clicked "换一个" -- silently doing nothing is not acceptable, so
    // verify the plan really changed and fall back to the rule-based picker.
    const updatedPlan = await prisma.dailyPlan.findUnique({ where: { id: plan.id } });
    const mealChanged = !!updatedPlan?.mealKey && updatedPlan.mealKey !== oldMealKey;
    if (!mealChanged) {
      const newMeal = await pickSwapMeal(userId, dateKey, oldMealKey, explicitDislikes);
      await prisma.dailyPlan.update({
        where: { id: plan.id },
        data: { mealKey: newMeal.key, mealTitle: newMeal.title, kcal: newMeal.kcal, status: "SWAPPED" },
      });
      await saveTrivialActionTrace({
        userId,
        trigger: "swap",
        goal: `Agent swap 轮未完成换菜（status=${result.status}），代码确定性兜底换成「${newMeal.title}」。`,
        planId: plan.id,
      });
    }

    // Memory writes are too important to depend on prompt obedience: if the
    // model skipped record_preference_signal, backfill the dislike in code.
    if (oldMealKey && !result.preferenceSignalRecorded) {
      await recordSwap(userId, oldMealKey);
    }

    await logEvent({ userId, eventType: "ACTION_SWAP", planType: "MORNING", mealKey: oldMealKey || undefined });

    if (oldMealKey) {
      await maybeAskSwapAttribution({
        userId,
        planId: plan.id,
        mealKey: oldMealKey,
        mealTitle: plan.mealTitle ?? oldMealKey,
        dateKey,
      });
    }
  } else if (action === "complete") {
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED" } });
    if (plan.mealKey) await recordCompletion(userId, plan.mealKey);
    await logEvent({ userId, eventType: "ACTION_COMPLETE", planType: plan.type, mealKey: plan.mealKey ?? undefined });
    await saveTrivialActionTrace({ userId, trigger: "complete", goal: "用户点击完成，无歧义状态转移。", planId: plan.id });
  } else if (action === "skip") {
    await prisma.dailyPlan.update({ where: { id: plan.id }, data: { status: "SKIPPED" } });
    await logEvent({ userId, eventType: "ACTION_SKIP", planType: plan.type, mealKey: plan.mealKey ?? undefined });
    await saveTrivialActionTrace({ userId, trigger: "skip", goal: "用户点击跳过，无歧义状态转移。", planId: plan.id });
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { respondedAt: new Date(), responseAction: action },
  });

  return { ok: true };
}

/**
 * Swap-attribution ask (the ground-truth loop for Tier2 memory). A swap is an
 * ambiguous signal -- "don't like it" vs "canteen didn't have it today" vs
 * "just wanted variety" -- so before a dislike inference starts filtering the
 * candidate list, confirm it with the user once.
 *
 * When/whether to ask is a deterministic CODE policy, not a model judgment:
 * - only when dislike confidence has reached the filter threshold (the answer
 *   decides whether this meal disappears from candidates -- worth one question)
 * - never for preferences the user already confirmed
 * - at most one ask_user message per day (don't turn the feed into a survey)
 */
async function maybeAskSwapAttribution(params: {
  userId: string;
  planId: string;
  mealKey: string;
  mealTitle: string;
  dateKey: string;
}) {
  const { userId, planId, mealKey, mealTitle, dateKey } = params;

  const pref = await prisma.preferenceMemory.findUnique({
    where: { userId_key: { userId, key: `dislike:${mealKey}` } },
  });
  if (!pref || pref.confidence < DISLIKE_THRESHOLD || pref.source === "user_confirmed") return;

  const startOfDay = new Date(`${dateKey}T00:00:00+08:00`);
  const askedToday = await prisma.message.findFirst({
    where: { userId, require: "ASK_USER", createdAt: { gte: startOfDay } },
  });
  if (askedToday) return;

  const ctx = createToolCtx(userId, dateKey);
  await messagingImpls.askUser(ctx, {
    planId,
    type: "MORNING",
    question: `注意到你换掉了「${mealTitle}」，之后要少推这类吗？`,
    options: [
      { label: "对，不太爱吃", value: "dislike" },
      { label: "今天没有/不方便", value: "unavailable" },
      { label: "就是想换换口味", value: "variety" },
    ],
    extraPayload: { kind: "swap_attribution", mealKey },
  });
}

export async function submitCheckin(userId: string, weightKg: number, difficulty?: number) {
  const dateKey = todayKey();

  const existing = await prisma.checkIn.findFirst({ where: { userId, date: dateKey } });
  if (existing) {
    await prisma.checkIn.update({ where: { id: existing.id }, data: { weightKg, difficulty } });
  } else {
    await prisma.checkIn.create({ data: { userId, date: dateKey, weightKg, difficulty } });
  }

  await logEvent({ userId, eventType: "CHECKIN", metadata: { weightKg, difficulty } });

  const eveningPlan = await prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId, date: dateKey, type: "EVENING" } },
  });
  if (eveningPlan && eveningPlan.status === "PENDING") {
    await prisma.dailyPlan.update({ where: { id: eveningPlan.id }, data: { status: "COMPLETED" } });
  }
  const eveningMessage = await prisma.message.findFirst({
    where: { userId, planId: eveningPlan?.id, type: "EVENING", respondedAt: null },
  });
  if (eveningMessage) {
    await prisma.message.update({
      where: { id: eveningMessage.id },
      data: { respondedAt: new Date(), responseAction: "checkin" },
    });
  }

  return { ok: true };
}

/** Respond to an `ask_user` clarification message with the chosen option value. */
export async function respondToAskUser(userId: string, messageId: string, optionValue: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.userId !== userId) throw new Error("Message not found");
  if (message.require !== "ASK_USER") throw new Error("Message is not an ask_user message");

  let payload: { kind?: string; mealKey?: string } = {};
  try {
    payload = JSON.parse(message.payload || "{}");
  } catch {
    payload = {};
  }

  // Swap-attribution answers correct Tier2 memory (the ground-truth loop):
  // confirmed dislike gets locked above the threshold and exempted from
  // decay; a misattributed swap gets its boost reverted.
  if (payload.kind === "swap_attribution" && payload.mealKey) {
    if (optionValue === "dislike") {
      await confirmDislike(userId, payload.mealKey);
    } else {
      await revertSwapSignal(userId, payload.mealKey);
    }
  }

  await logEvent({
    userId,
    eventType: "ASK_USER_RESPONDED",
    metadata: { messageId, optionValue, kind: payload.kind, mealKey: payload.mealKey, answer: optionValue },
  });
  await prisma.message.update({
    where: { id: message.id },
    data: { respondedAt: new Date(), responseAction: optionValue },
  });

  return { ok: true };
}
