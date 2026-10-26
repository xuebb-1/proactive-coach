import { z } from "zod";
import { tool } from "ai";
import { writeTransaction } from "@/lib/operations";
import { endOfToday } from "@/lib/date";
import type { ToolCtx } from "./context";
import type { Prisma, PlanType, MessageRequire } from "@/app/generated/prisma/client";

async function deliver(ctx: ToolCtx, args: {
  planId?: string; type: PlanType; text: string; require: MessageRequire; payload?: Record<string, unknown>;
}) {
  if (ctx.trigger === "swap") throw new Error("换菜轮不能发送新消息。");
  if (ctx.trigger && args.type !== ctx.trigger.toUpperCase()) throw new Error("消息类型与触发时段不符。");
  // A model's terminal question uses its normal daily slot. A code-driven
  // attribution question has a fresh context without a trigger and its own slot.
  const slot = ctx.trigger ? args.type : args.require === "ASK_USER" ? "ASK_USER" : args.type;
  const deliveryKey = `${ctx.userId}:${ctx.dateKey}:${slot}`;
  const message = await writeTransaction(async (db) => {
    const existing = await db.message.findUnique({ where: { deliveryKey } });
    if (existing) return existing;

    // Keep pre-reliability Beta deliveries addressable by their old Inngest key.
    const legacy = slot !== "ASK_USER" && ctx.messageDedupeKey
      ? await db.message.findUnique({ where: { dedupeKey: ctx.messageDedupeKey } }) : null;
    if (legacy) {
      if (legacy.userId !== ctx.userId || legacy.type !== args.type || (legacy.deliveryKey && legacy.deliveryKey !== deliveryKey)) {
        throw new Error("历史投递标识不属于当前用户或时段。");
      }
      return db.message.update({ where: { id: legacy.id }, data: { deliveryKey } });
    }

    const planId = args.planId ?? ctx.finalPlanId;
    const interactive = ["CONFIRM_OR_SWAP", "CONFIRM_OR_SKIP", "CHECKIN"].includes(args.require);
    if (ctx.finalPlanId && planId !== ctx.finalPlanId) throw new Error("消息不能关联其他计划。");
    if (planId) {
      const plan = await db.dailyPlan.findUniqueOrThrow({ where: { id: planId, userId: ctx.userId, date: ctx.dateKey } });
      const expectedPlanType = args.type === "EVENING" ? "EVENING" : "MORNING";
      if (plan.type !== expectedPlanType) throw new Error("消息不能关联其他时段的计划。");
      if (interactive && (!["PENDING", "CONFIRMED", "SWAPPED"].includes(plan.status) ||
          (plan.expiresAt && plan.expiresAt <= new Date()) || (plan.type === "MORNING" && !plan.mealKey))) {
        throw new Error("该计划已不可操作，请使用 NONE 发送说明。");
      }
    }
    if (interactive && !planId) {
      throw new Error("交互消息必须关联有效计划。");
    }
    const expected = { MORNING: "CONFIRM_OR_SWAP", LUNCH: "CONFIRM_OR_SKIP", EVENING: "CHECKIN" };
    if (![expected[args.type], "NONE", "ASK_USER"].includes(args.require)) throw new Error("消息操作与时段不符。");
    const data: Prisma.MessageUncheckedCreateInput = {
      deliveryKey, dedupeKey: slot !== "ASK_USER" ? ctx.messageDedupeKey : undefined,
      userId: ctx.userId, planId, type: args.type, text: args.text, require: args.require,
      payload: JSON.stringify(args.payload ?? {}), expiresAt: ctx.dayEndsAt ?? endOfToday(),
    };
    return db.message.upsert({ where: { deliveryKey }, create: data, update: {} });
  });
  ctx.finalMessageId = message.id;
  return { messageId: message.id };
}

export const messagingImpls = {
  async sendProactiveMessage(ctx: ToolCtx, args: {
    planId?: string; type: "MORNING" | "LUNCH" | "EVENING"; text: string;
    require: "CONFIRM_OR_SWAP" | "CONFIRM_OR_SKIP" | "CHECKIN" | "NONE"; payload?: Record<string, unknown>;
  }) {
    return deliver(ctx, args);
  },
  async askUser(ctx: ToolCtx, args: {
    planId?: string; type: "MORNING" | "LUNCH" | "EVENING"; question: string;
    options: Array<{ label: string; value: string }>; extraPayload?: Record<string, unknown>;
  }) {
    return deliver(ctx, {
      ...args, text: args.question, require: "ASK_USER",
      payload: { question: args.question, options: args.options, ...(args.extraPayload ?? {}) },
    });
  },
};

export function buildMessagingTools(ctx: ToolCtx) {
  return {
    send_proactive_message: tool({
      description: "将最终消息写入 Feed，同一时段只投递一次。没有合适候选时使用 NONE 并说明原因。",
      inputSchema: z.object({
        planId: z.string().optional(), type: z.enum(["MORNING", "LUNCH", "EVENING"]), text: z.string().min(1),
        require: z.enum(["CONFIRM_OR_SWAP", "CONFIRM_OR_SKIP", "CHECKIN", "NONE"]), payload: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (args) => messagingImpls.sendProactiveMessage(ctx, args),
    }),
    ask_user: tool({
      description: "确实需要澄清时发出一条带选项的问题，作为本轮的最终消息。",
      inputSchema: z.object({
        planId: z.string().optional(), type: z.enum(["MORNING", "LUNCH", "EVENING"]), question: z.string().min(1),
        options: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(4),
      }),
      execute: async (args) => messagingImpls.askUser(ctx, args),
    }),
  };
}
