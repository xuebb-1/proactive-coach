import { prisma } from "@/lib/db";
import { recordCompletion } from "@/lib/memory/preference";
import { logEvent } from "@/lib/memory/episodic";
import { todayKey } from "@/lib/date";
import { runActionTurn, saveTrivialActionTrace } from "@/lib/agent/runner";
import { buildSwapGoal } from "@/lib/agent/prompts";

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

    await runActionTurn({
      userId,
      trigger: "swap",
      goal,
      dateKey,
      explicitDislikedFoods: explicitDislikes,
      planId: plan.id,
    });
    await logEvent({ userId, eventType: "ACTION_SWAP", planType: "MORNING", mealKey: oldMealKey || undefined });
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

  await logEvent({ userId, eventType: "ASK_USER_RESPONDED", metadata: { messageId, optionValue } });
  await prisma.message.update({
    where: { id: message.id },
    data: { respondedAt: new Date(), responseAction: optionValue },
  });

  return { ok: true };
}
