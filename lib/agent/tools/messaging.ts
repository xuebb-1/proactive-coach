import { z } from "zod";
import { tool } from "ai";
import { prisma } from "@/lib/db";
import type { ToolCtx } from "./context";

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export const messagingImpls = {
  async sendProactiveMessage(
    ctx: ToolCtx,
    args: {
      planId?: string;
      type: "MORNING" | "LUNCH" | "EVENING";
      text: string;
      require: "CONFIRM_OR_SWAP" | "CONFIRM_OR_SKIP" | "CHECKIN" | "NONE";
      payload?: Record<string, unknown>;
    }
  ) {
    const message = await prisma.message.create({
      data: {
        userId: ctx.userId,
        planId: args.planId ?? ctx.finalPlanId ?? null,
        type: args.type,
        text: args.text,
        require: args.require,
        payload: JSON.stringify(args.payload ?? {}),
        expiresAt: endOfToday(),
      },
    });
    ctx.finalMessageId = message.id;
    return { messageId: message.id };
  },

  async askUser(
    ctx: ToolCtx,
    args: {
      planId?: string;
      type: "MORNING" | "LUNCH" | "EVENING";
      question: string;
      options: Array<{ label: string; value: string }>;
    }
  ) {
    const message = await prisma.message.create({
      data: {
        userId: ctx.userId,
        planId: args.planId ?? ctx.finalPlanId ?? null,
        type: args.type,
        text: args.question,
        require: "ASK_USER",
        payload: JSON.stringify({ question: args.question, options: args.options }),
        expiresAt: endOfToday(),
      },
    });
    ctx.finalMessageId = message.id;
    return { messageId: message.id };
  },
};

/**
 * Terminal tools. Exactly one of send_proactive_message / ask_user should be
 * the last thing a cron-trigger turn calls -- the model can plan and read
 * memory all it wants, but it can never write text to the user's feed
 * without going through here.
 */
export function buildMessagingTools(ctx: ToolCtx) {
  const send_proactive_message = tool({
    description:
      "把最终文案写入用户的 Feed。type 决定这是早/中/晚哪一轮消息；require 决定前端渲染哪种按钮。这是本轮通常的最后一步。",
    inputSchema: z.object({
      planId: z.string().optional(),
      type: z.enum(["MORNING", "LUNCH", "EVENING"]),
      text: z.string().min(1),
      require: z.enum(["CONFIRM_OR_SWAP", "CONFIRM_OR_SKIP", "CHECKIN", "NONE"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async (args) => messagingImpls.sendProactiveMessage(ctx, args),
  });

  const ask_user = tool({
    description:
      "当置信度不足、需要用户做一次结构化选择才能继续时，发一条澄清消息（带 quick options），而不是直接猜。这也是终止本轮的一种方式，和 send_proactive_message 二选一。",
    inputSchema: z.object({
      planId: z.string().optional(),
      type: z.enum(["MORNING", "LUNCH", "EVENING"]),
      question: z.string().min(1),
      options: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .min(2)
        .max(4),
    }),
    execute: async (args) => messagingImpls.askUser(ctx, args),
  });

  return { send_proactive_message, ask_user };
}
