import { UserInputError } from "@/lib/user-error";
import { prisma } from "@/lib/db";
import { recordCompletion, recordSwap, confirmDislike, revertSwapSignal, DISLIKE_THRESHOLD } from "@/lib/memory/preference";
import { logEvent } from "@/lib/memory/episodic";
import { endOfDayForTimeZone, todayKeyForTimeZone } from "@/lib/date";
import { runActionTurn, saveTrivialActionTrace } from "@/lib/agent/runner";
import { getScenario } from "@/lib/scenarios/registry";
import { messagingImpls } from "@/lib/agent/tools/messaging";
import { createToolCtx } from "@/lib/agent/tools/context";
import { withUserOperation, writeTransaction } from "@/lib/operations";
import type { Prisma } from "@/app/generated/prisma/client";

export type ButtonAction = "confirm" | "swap" | "complete" | "skip";

function messagePayload(raw: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(raw);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function respondToMessage(userId: string, messageId: string, action: ButtonAction) {
  return withUserOperation(userId, `message:${messageId}:${action}`, async () => {
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { plan: true } });
    if (!message || message.userId !== userId || !message.plan || message.plan.userId !== userId) throw new UserInputError("找不到这条计划消息。");
    if (message.respondedAt) {
      if (message.responseAction === action) return { ok: true };
      throw new UserInputError("这条消息已经处理过，请刷新页面。");
    }
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) throw new UserInputError("请先完成个人资料。");
    const now = new Date();
    const dateKey = todayKeyForTimeZone(profile.timezone, now);
    const dayEndsAt = endOfDayForTimeZone(profile.timezone, now);
    if (!message.expiresAt || message.expiresAt <= now || message.plan.date !== dateKey ||
        (message.plan.expiresAt && message.plan.expiresAt <= now)) throw new UserInputError("这条消息已过期。");
    const allowed = message.require === "CONFIRM_OR_SWAP" ? ["confirm", "swap"] : message.require === "CONFIRM_OR_SKIP" ? ["complete", "skip"] : [];
    if (!allowed.includes(action)) throw new UserInputError("该消息不支持这个操作。");
    const plan = message.plan;
    if (!["PENDING", "CONFIRMED", "SWAPPED"].includes(plan.status)) throw new UserInputError("该计划已经结束，请刷新页面。");

    if (action === "swap") {
      const payload = messagePayload(message.payload);
      const swapFrom = typeof payload.swapFrom === "string" ? payload.swapFrom : undefined;
      const oldMealKey = swapFrom ?? plan.mealKey;
      if (!oldMealKey) throw new UserInputError("当前计划没有可替换的餐食。");
      const explicitDislikes: string[] = JSON.parse(profile.dislikedFoods || "[]");
      const scenario = getScenario(profile.scenarioId);
      if (!swapFrom) await writeTransaction((db) => db.message.update({
        where: { id: messageId }, data: { payload: JSON.stringify({ ...payload, swapFrom: oldMealKey }) },
      }));

      // A previous worker may have changed the plan before failing to acknowledge the message.
      if (plan.mealKey === oldMealKey) {
        const result = await runActionTurn({
          userId, trigger: "swap", dateKey, explicitDislikedFoods: explicitDislikes,
          planId: plan.id, previousMealKey: oldMealKey, dayEndsAt, scenarioId: scenario.id,
          goal: scenario.buildSwapGoal({ dateKey, planId: plan.id, oldMealKey, oldMealTitle: plan.mealTitle ?? oldMealKey }),
        });
        const updated = await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } });
        if (!updated.mealKey || updated.mealKey === oldMealKey) {
          const replacement = await scenario.pickSwapMeal(userId, dateKey, oldMealKey, explicitDislikes);
          await writeTransaction((db) => db.dailyPlan.update({
            where: { id: plan.id },
            data: { mealKey: replacement.key, mealTitle: replacement.title, kcal: replacement.kcal, status: "SWAPPED" },
          }));
          await saveTrivialActionTrace({
            userId, trigger: "swap", planId: plan.id, goal: `模型换菜结果为 ${result.status}，由备用流程完成换菜。`,
          });
        }
      }
      await writeTransaction(async (db) => {
        await recordSwap(userId, oldMealKey);
        await logEvent({ userId, eventType: "ACTION_SWAP", planType: "MORNING", mealKey: oldMealKey });
        await db.message.update({ where: { id: messageId }, data: { respondedAt: new Date(), responseAction: action } });
        await maybeAskSwapAttribution(db, {
          userId, planId: plan.id, mealKey: oldMealKey, mealTitle: oldMealKey, dateKey, dayEndsAt, scenarioId: scenario.id,
        });
      });
      return { ok: true };
    }

    return writeTransaction(async (db) => {
      const status = action === "confirm" ? "CONFIRMED" : action === "complete" ? "COMPLETED" : "SKIPPED";
      await db.dailyPlan.update({ where: { id: plan.id }, data: { status } });
      if (action === "complete" && plan.mealKey) await recordCompletion(userId, plan.mealKey);
      await logEvent({
        userId, eventType: action === "confirm" ? "ACTION_CONFIRM" : action === "complete" ? "ACTION_COMPLETE" : "ACTION_SKIP",
        planType: plan.type, mealKey: plan.mealKey ?? undefined,
      });
      await saveTrivialActionTrace({ userId, trigger: action, goal: `用户操作：${action}。`, planId: plan.id });
      await db.message.update({ where: { id: messageId }, data: { respondedAt: new Date(), responseAction: action } });
      return { ok: true };
    });
  });
}

async function maybeAskSwapAttribution(db: Prisma.TransactionClient, params: {
  userId: string; planId: string; mealKey: string; mealTitle: string; dateKey: string; dayEndsAt: Date; scenarioId: string;
}) {
  const { userId, mealKey, dateKey } = params;
  const pref = await db.preferenceMemory.findUnique({ where: { userId_key: { userId, key: `dislike:${mealKey}` } } });
  if (!pref || pref.confidence < DISLIKE_THRESHOLD || pref.source === "user_confirmed") return;
  if (await db.message.findUnique({ where: { deliveryKey: `${userId}:${dateKey}:ASK_USER` } })) return;
  const meal = await db.meal.findFirst({ where: { key: mealKey, OR: [{ ownerId: null }, { ownerId: userId }] } });
  // No trigger: business attribution owns ASK_USER, separate from a model's terminal daily message.
  await messagingImpls.askUser(createToolCtx(userId, dateKey, {
    dayEndsAt: params.dayEndsAt, scenarioId: params.scenarioId,
  }), {
    planId: params.planId, type: "MORNING",
    question: `注意到你换掉了「${meal?.title ?? params.mealTitle}」，之后要少推这类吗？`,
    options: [
      { label: "对，不太爱吃", value: "dislike" },
      { label: "今天没有/不方便", value: "unavailable" },
      { label: "就是想换换口味", value: "variety" },
    ],
    extraPayload: { kind: "swap_attribution", mealKey },
  });
}

export async function submitCheckin(userId: string, weightKg: number, difficulty?: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500 ||
      (difficulty !== undefined && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5))) throw new UserInputError("请输入有效的打卡数据。");
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
  if (!profile) throw new UserInputError("请先完成个人资料。");
  const dateKey = todayKeyForTimeZone(profile.timezone);
  return withUserOperation(userId, `checkin:${userId}:${dateKey}:${weightKg}:${difficulty ?? ""}`, () => writeTransaction(async (db) => {
    await db.checkIn.upsert({
      where: { userId_date: { userId, date: dateKey } },
      create: { userId, date: dateKey, weightKg, difficulty }, update: { weightKg, difficulty },
    });
    await logEvent({ userId, eventType: "CHECKIN", metadata: { weightKg, difficulty } });
    const eveningPlan = await db.dailyPlan.findUnique({ where: { userId_date_type: { userId, date: dateKey, type: "EVENING" } } });
    if (eveningPlan) {
      await db.dailyPlan.update({ where: { id: eveningPlan.id }, data: { status: "COMPLETED" } });
      await db.message.updateMany({
        where: { userId, planId: eveningPlan.id, type: "EVENING", require: "CHECKIN", respondedAt: null },
        data: { respondedAt: new Date(), responseAction: "checkin" },
      });
    }
    return { ok: true };
  }));
}

export async function respondToAskUser(userId: string, messageId: string, optionValue: string) {
  return withUserOperation(userId, `answer:${messageId}`, () => writeTransaction(async (db) => {
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (!message || message.userId !== userId || message.require !== "ASK_USER") throw new UserInputError("找不到这个问题。");
    if (message.respondedAt) {
      if (message.responseAction === optionValue) return { ok: true };
      throw new UserInputError("这个问题已经回答过，请刷新页面。");
    }
    if (!message.expiresAt || message.expiresAt <= new Date()) throw new UserInputError("这个问题已过期。");
    const payload = messagePayload(message.payload);
    const options = Array.isArray(payload.options) ? payload.options : [];
    if (!options.some((option: unknown) => option && typeof option === "object" && "value" in option && option.value === optionValue)) throw new UserInputError("请选择有效的选项。");
    if (payload.kind === "swap_attribution" && typeof payload.mealKey === "string") {
      if (optionValue === "dislike") await confirmDislike(userId, payload.mealKey);
      else await revertSwapSignal(userId, payload.mealKey);
    }
    await logEvent({
      userId, eventType: "ASK_USER_RESPONDED",
      metadata: { messageId, optionValue, kind: payload.kind, mealKey: payload.mealKey, answer: optionValue },
    });
    await db.message.update({ where: { id: messageId }, data: { respondedAt: new Date(), responseAction: optionValue } });
    return { ok: true };
  }));
}
