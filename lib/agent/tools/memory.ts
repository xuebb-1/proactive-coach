import { z } from "zod";
import { tool } from "ai";
import { prisma } from "@/lib/db";
import { searchPreferences, recordPreferenceSignal } from "@/lib/memory/preference";
import { getRecentEpisodes, logEvent } from "@/lib/memory/episodic";
import { getEngagementTrend } from "@/lib/orchestrator/engagement";
import { daysBetween } from "@/lib/date";
import type { ToolCtx } from "./context";

/**
 * Plain business-logic implementations, kept separate from the `tool()`
 * wrappers below so the runner can call them directly for the mock-mode
 * deterministic loop and for deterministic fallbacks -- without fighting the
 * AI SDK's `ToolExecuteFunction` signature.
 */
export const memoryImpls = {
  async getUserProfile(ctx: ToolCtx) {
    const [profile, persona] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: ctx.userId } }),
      prisma.personaProfile.findUnique({ where: { userId: ctx.userId } }),
    ]);
    if (!profile || !persona) return { error: "profile_not_found" };
    const daysUntilEvent =
      persona.motivationHook === "event" && persona.eventDate
        ? Math.max(0, daysBetween(new Date(persona.eventDate), new Date()))
        : null;
    return {
      goalWeightKg: profile.goalWeightKg,
      currentWeightKg: profile.currentWeightKg,
      dislikedFoods: JSON.parse(profile.dislikedFoods || "[]") as string[],
      tonePreference: persona.tonePreference,
      motivationHook: persona.motivationHook,
      eventLabel: persona.eventLabel,
      daysUntilEvent,
    };
  },

  async searchPreferences(ctx: ToolCtx, args: { category?: string; minConfidence?: number }) {
    const rows = await searchPreferences(ctx.userId, args);
    return rows.map((r) => ({
      key: r.key,
      category: r.category,
      confidence: r.confidence,
      evidenceCount: r.evidenceCount,
      lastConfirmedAt: r.lastConfirmedAt.toISOString(),
    }));
  },

  async getRecentEpisodes(ctx: ToolCtx, args: { days?: number; limit?: number }) {
    const rows = await getRecentEpisodes(ctx.userId, args.days ?? 7, args.limit ?? 20);
    return rows.map((r) => ({
      eventType: r.eventType,
      planType: r.planType,
      mealKey: r.mealKey,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  },

  async getEngagementTrend(ctx: ToolCtx) {
    return { trend: await getEngagementTrend(ctx.userId) };
  },

  async recordPreferenceSignal(ctx: ToolCtx, args: { mealKey: string; signal: "dislike" | "like" }) {
    await recordPreferenceSignal(ctx.userId, args.mealKey, args.signal);
    return { ok: true, mealKey: args.mealKey, signal: args.signal };
  },

  async logEpisode(
    ctx: ToolCtx,
    args: {
      eventType: "PLAN_GENERATED" | "ACTION_CONFIRM" | "ACTION_SWAP" | "ACTION_COMPLETE" | "ACTION_SKIP" | "AUTO_ACCEPTED";
      mealKey?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    await logEvent({ userId: ctx.userId, eventType: args.eventType, mealKey: args.mealKey, metadata: args.metadata });
    return { ok: true };
  },
};

export function buildMemoryTools(ctx: ToolCtx) {
  const get_user_profile = tool({
    description:
      "读取 Tier1 用户画像与人设（目标体重、当前体重、明确不吃的食物、语气偏好、动机 hook、若为 event 类型则含事件名和倒计时天数）。每轮开始时应先调用。",
    inputSchema: z.object({}),
    execute: async () => memoryImpls.getUserProfile(ctx),
  });

  const search_preferences = tool({
    description: "按 category（food/exercise）和最低置信度查询 Tier2 学习到的偏好（不是用户明确填写的，是从行为推断的）。",
    inputSchema: z.object({
      category: z.enum(["food", "exercise"]).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
    }),
    execute: async (args) => memoryImpls.searchPreferences(ctx, args),
  });

  const get_recent_episodes = tool({
    description: "读取近 N 天的 Tier3 原始事件日志（计划生成、确认/换/完成/跳过、签到等），用于理解用户近期行为模式。",
    inputSchema: z.object({
      days: z.number().min(1).max(30).default(7),
      limit: z.number().min(1).max(50).default(20),
    }),
    execute: async (args) => memoryImpls.getRecentEpisodes(ctx, args),
  });

  const get_engagement_trend = tool({
    description: "计算近 7 天 vs 前 7 天的完成率趋势（up/stable/down），用于决定该软化还是保持原语气。",
    inputSchema: z.object({}),
    execute: async () => memoryImpls.getEngagementTrend(ctx),
  });

  const record_preference_signal = tool({
    description:
      "记录一次针对某道菜的『喜欢/不喜欢』离散信号，只能传 dislike 或 like，不能传具体置信度数值——置信度的增量由系统代码计算，不接受模型给的浮点数。",
    inputSchema: z.object({
      mealKey: z.string(),
      signal: z.enum(["dislike", "like"]),
    }),
    execute: async (args) => memoryImpls.recordPreferenceSignal(ctx, args),
  });

  const log_episode = tool({
    description: "写入 Tier3 事件日志（追加，不可覆盖）。仅用于记录本轮已发生的、非计划/消息类的辅助事件。",
    inputSchema: z.object({
      eventType: z.enum([
        "PLAN_GENERATED",
        "ACTION_CONFIRM",
        "ACTION_SWAP",
        "ACTION_COMPLETE",
        "ACTION_SKIP",
        "AUTO_ACCEPTED",
      ]),
      mealKey: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async (args) => memoryImpls.logEpisode(ctx, args),
  });

  return {
    get_user_profile,
    search_preferences,
    get_recent_episodes,
    get_engagement_trend,
    record_preference_signal,
    log_episode,
  };
}
