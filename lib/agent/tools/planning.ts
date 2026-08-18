import { z } from "zod";
import { tool } from "ai";
import { prisma } from "@/lib/db";
import { getCandidateMeals } from "@/lib/scenarios/weightloss/planner";
import { getRecipeByKey } from "@/lib/scenarios/weightloss/meals";
import { endOfToday } from "@/lib/date";
import { logEvent } from "@/lib/memory/episodic";
import type { ToolCtx } from "./context";

export function assertValidMealKey(ctx: Pick<ToolCtx, "lastCandidateKeys">, mealKey: string) {
  // No "known recipe" escape hatch: a key can be real but belong to the wrong
  // eating-mode library (observed in testing -- list_candidate_meals errored,
  // the model wrote a cook-library key from memory for a canteen user).
  // Fetching candidates first is mandatory, full stop.
  if (ctx.lastCandidateKeys.size === 0) {
    throw new Error(
      `invalid_meal_key: 本轮还没有调用过 list_candidate_meals，不能直接写入 mealKey="${mealKey}"。请先调用 list_candidate_meals。`
    );
  }
  if (!ctx.lastCandidateKeys.has(mealKey)) {
    throw new Error(
      `invalid_meal_key: "${mealKey}" 不在最近一次 list_candidate_meals 返回的候选里，请从候选中选择。`
    );
  }
}

/**
 * Plain business-logic implementations. The whitelist guardrail lives here,
 * in code, not just in the prompt: create/update reject any mealKey that
 * wasn't in the most recent list_candidate_meals result.
 */
export const planningImpls = {
  async listCandidateMeals(
    ctx: ToolCtx,
    args: { explicitDislikedFoods: string[]; excludeMealKeys?: string[] }
  ) {
    const candidates = await getCandidateMeals(ctx.userId, args.explicitDislikedFoods, args.excludeMealKeys ?? []);
    ctx.lastCandidateKeys = new Set(candidates.map((c) => c.key));
    return candidates.map((c) => ({ mealKey: c.key, title: c.title, kcal: c.kcal, tags: c.tags }));
  },

  async createDailyPlan(ctx: ToolCtx, args: { type: "MORNING" | "EVENING"; mealKey?: string }) {
    let meal: { title: string; kcal: number } | undefined;
    if (args.mealKey) {
      assertValidMealKey(ctx, args.mealKey);
      meal = await getRecipeByKey(args.mealKey);
    }
    const existed = await prisma.dailyPlan.findUnique({
      where: { userId_date_type: { userId: ctx.userId, date: ctx.dateKey, type: args.type } },
      select: { id: true },
    });
    const plan = await prisma.dailyPlan.upsert({
      where: { userId_date_type: { userId: ctx.userId, date: ctx.dateKey, type: args.type } },
      create: {
        userId: ctx.userId,
        date: ctx.dateKey,
        type: args.type,
        mealKey: args.mealKey ?? null,
        mealTitle: meal?.title ?? null,
        kcal: meal?.kcal ?? null,
        status: "PENDING",
        expiresAt: endOfToday(),
      },
      update: {
        mealKey: args.mealKey ?? undefined,
        mealTitle: meal?.title ?? undefined,
        kcal: meal?.kcal ?? undefined,
      },
    });
    ctx.finalPlanId = plan.id;
    // Tier3 completeness: PLAN_GENERATED is logged by code, not left to the
    // model's discretion. Only on first creation -- upsert re-runs (idempotent
    // retriggers) must not spam the episodic log.
    if (!existed) {
      await logEvent({ userId: ctx.userId, eventType: "PLAN_GENERATED", planType: args.type, mealKey: plan.mealKey ?? undefined });
    }
    return { planId: plan.id, mealKey: plan.mealKey, mealTitle: plan.mealTitle, kcal: plan.kcal, status: plan.status };
  },

  async updateDailyPlan(
    ctx: ToolCtx,
    args: {
      planId: string;
      mealKey?: string;
      status?: "PENDING" | "CONFIRMED" | "SWAPPED" | "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED";
    }
  ) {
    let meal: { title: string; kcal: number } | undefined;
    if (args.mealKey) {
      assertValidMealKey(ctx, args.mealKey);
      meal = await getRecipeByKey(args.mealKey);
    }
    const plan = await prisma.dailyPlan.update({
      where: { id: args.planId },
      data: {
        mealKey: args.mealKey ?? undefined,
        mealTitle: meal?.title ?? undefined,
        kcal: meal?.kcal ?? undefined,
        status: args.status ?? undefined,
      },
    });
    ctx.finalPlanId = plan.id;
    return { planId: plan.id, mealKey: plan.mealKey, mealTitle: plan.mealTitle, kcal: plan.kcal, status: plan.status };
  },
};

export function buildPlanningTools(ctx: ToolCtx, opts: { explicitDislikedFoods: string[] }) {
  const list_candidate_meals = tool({
    description:
      "获取今天可选的候选菜列表（已按明确不吃的食物、Tier2 学习到的厌恶偏好、近 3 天重复过滤）。之后创建/更新计划时，mealKey 只能从这里返回的 key 里选，不能自己编。",
    inputSchema: z.object({
      excludeMealKeys: z.array(z.string()).optional().describe("额外要排除的 key，比如当前正在被换掉的那道菜"),
    }),
    execute: async ({ excludeMealKeys }) =>
      planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: opts.explicitDislikedFoods, excludeMealKeys }),
  });

  const create_daily_plan = tool({
    description:
      "创建当日计划。type 只能是 MORNING 或 EVENING——LUNCH 从不单独建计划，午间提醒要用 update_daily_plan 去关联当天已有的 MORNING 计划。使用 upsert 语义，重复调用同一天同一 type 是安全的（不会报错，只会覆盖）。",
    inputSchema: z.object({
      type: z.enum(["MORNING", "EVENING"]),
      mealKey: z.string().optional().describe("MORNING 必填；EVENING 一般不需要"),
    }),
    execute: async (args) => planningImpls.createDailyPlan(ctx, args),
  });

  const update_daily_plan = tool({
    description:
      "更新一个已存在的计划（换菜、改状态）。用于：swap 换菜场景、lunch 场景关联到已有的 morning 计划。mealKey 同样必须来自 list_candidate_meals 的候选。",
    inputSchema: z.object({
      planId: z.string(),
      mealKey: z.string().optional(),
      status: z.enum(["PENDING", "CONFIRMED", "SWAPPED", "COMPLETED", "SKIPPED", "AUTO_ACCEPTED"]).optional(),
    }),
    execute: async (args) => planningImpls.updateDailyPlan(ctx, args),
  });

  return { list_candidate_meals, create_daily_plan, update_daily_plan };
}
