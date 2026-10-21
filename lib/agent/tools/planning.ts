import { z } from "zod";
import { tool } from "ai";
import { writeTransaction } from "@/lib/operations";
import { getCandidateMeals } from "@/lib/scenarios/weightloss/planner";
import { endOfToday } from "@/lib/date";
import { logEvent } from "@/lib/memory/episodic";
import type { ToolCtx } from "./context";

export function assertValidMealKey(ctx: Pick<ToolCtx, "lastCandidateKeys">, mealKey: string) {
  if (!ctx.lastCandidateKeys.size || !ctx.lastCandidateKeys.has(mealKey)) {
    throw new Error("invalid_meal_key: 请先调用 list_candidate_meals，再从最近一次返回的候选中选择。");
  }
}

export const planningImpls = {
  async listCandidateMeals(ctx: ToolCtx, args: { explicitDislikedFoods: string[]; excludeMealKeys?: string[] }) {
    const exclude = [...(args.excludeMealKeys ?? []), ...(ctx.swapMealKey ? [ctx.swapMealKey] : [])];
    const candidates = await getCandidateMeals(ctx.userId, args.explicitDislikedFoods, exclude);
    ctx.lastCandidateKeys = new Set(candidates.map((meal) => meal.key));
    return candidates.map((meal) => ({ mealKey: meal.key, title: meal.title, kcal: meal.kcal, tags: meal.tags }));
  },

  async createDailyPlan(ctx: ToolCtx, args: { type: "MORNING" | "EVENING"; mealKey?: string }) {
    if (ctx.trigger && (ctx.trigger !== "morning" || args.type !== "MORNING")) throw new Error("本轮不能创建新计划。");
    if (args.type === "MORNING" && !args.mealKey) throw new Error("早间计划必须选择可用餐食。");
    if (args.mealKey) assertValidMealKey(ctx, args.mealKey);
    const plan = await writeTransaction(async (db) => {
      const meal = args.mealKey ? await db.meal.findUnique({ where: { key: args.mealKey, isActive: true } }) : null;
      if (args.mealKey && !meal) throw new Error("该方案已停用，请重新获取候选。");
      const existing = await db.dailyPlan.findUnique({ where: { userId_date_type: { userId: ctx.userId, date: ctx.dateKey, type: args.type } } });
      // Retrying a partially completed turn must not replace an existing decision.
      if (existing) return existing;
      const created = await db.dailyPlan.create({
        data: { userId: ctx.userId, date: ctx.dateKey, type: args.type, mealKey: meal?.key, mealTitle: meal?.title, kcal: meal?.kcal, expiresAt: endOfToday() },
      });
      await logEvent({ userId: ctx.userId, eventType: "PLAN_GENERATED", planType: args.type, mealKey: created.mealKey ?? undefined });
      return created;
    });
    ctx.finalPlanId = plan.id;
    return plan;
  },

  async updateDailyPlan(ctx: ToolCtx, args: { planId: string; mealKey?: string; status?: "PENDING" | "CONFIRMED" | "SWAPPED" | "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" }) {
    if (ctx.finalPlanId && ctx.finalPlanId !== args.planId) throw new Error("不能修改本轮以外的计划。");
    if (ctx.trigger !== "swap" && (args.mealKey || args.status)) throw new Error("只有换菜轮可以通过工具修改餐食。");
    if (ctx.trigger === "swap" && (!args.mealKey || args.status !== "SWAPPED")) throw new Error("换菜必须提供新餐食并设置 SWAPPED。");
    if (args.mealKey) assertValidMealKey(ctx, args.mealKey);
    const plan = await writeTransaction(async (db) => {
      const existing = await db.dailyPlan.findUniqueOrThrow({ where: { id: args.planId, userId: ctx.userId, date: ctx.dateKey } });
      if (["COMPLETED", "SKIPPED", "EXPIRED", "NO_RESPONSE"].includes(existing.status)) throw new Error("该计划已结束。");
      const meal = args.mealKey ? await db.meal.findUnique({ where: { key: args.mealKey, isActive: true } }) : null;
      if (args.mealKey && !meal) throw new Error("该方案已停用。");
      return db.dailyPlan.update({
        where: { id: existing.id },
        data: { mealKey: meal?.key, mealTitle: meal?.title, kcal: meal?.kcal, status: args.status },
      });
    });
    ctx.finalPlanId = plan.id;
    return plan;
  },
};

export function buildPlanningTools(ctx: ToolCtx, opts: { explicitDislikedFoods: string[] }) {
  return {
    list_candidate_meals: tool({
      description: "获取已按忌口、偏好和近期重复筛选的候选；可能为空，此时不要编造方案。",
      inputSchema: z.object({ excludeMealKeys: z.array(z.string()).optional() }),
      execute: async (args) => planningImpls.listCandidateMeals(ctx, { ...args, explicitDislikedFoods: opts.explicitDislikedFoods }),
    }),
    create_daily_plan: tool({
      description: "仅早间轮创建 MORNING 计划。午间复用早间计划，晚间计划已由调度器创建。",
      inputSchema: z.object({ type: z.enum(["MORNING", "EVENING"]), mealKey: z.string().optional() }),
      execute: async (args) => planningImpls.createDailyPlan(ctx, args),
    }),
    update_daily_plan: tool({
      description: "换菜轮更新当前计划，mealKey 必须来自本轮候选。其他轮只能关联已有计划。",
      inputSchema: z.object({ planId: z.string(), mealKey: z.string().optional(), status: z.enum(["PENDING", "CONFIRMED", "SWAPPED", "COMPLETED", "SKIPPED", "AUTO_ACCEPTED"]).optional() }),
      execute: async (args) => planningImpls.updateDailyPlan(ctx, args),
    }),
  };
}
