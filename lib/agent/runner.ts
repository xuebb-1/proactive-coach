import { generateText, stepCountIs } from "ai";
import { prisma } from "@/lib/db";
import { getAgentMode, getModel } from "./provider";
import { buildTools, createToolCtx, type ToolCtx } from "./tools";
import { memoryImpls } from "./tools/memory";
import { planningImpls } from "./tools/planning";
import { messagingImpls } from "./tools/messaging";
import { SYSTEM_PROMPT } from "./prompts";
import { saveTrace, type TraceStep } from "./trace";

const MAX_STEPS = 6;

export type AgentTrigger = "morning" | "lunch" | "evening";
export type ActionTrigger = "swap";

type MessageType = "MORNING" | "LUNCH" | "EVENING";

const TRIGGER_TO_MESSAGE_TYPE: Record<AgentTrigger, MessageType> = {
  morning: "MORNING",
  lunch: "LUNCH",
  evening: "EVENING",
};

export type AgentTurnResult = {
  status: "complete" | "incomplete" | "failed";
  finalMessageId?: string;
  planId?: string;
  traceId: string;
};

/**
 * Cron-trigger turn: morning/lunch/evening. Always ends in exactly one
 * message being sent (or a deterministic fallback message if the model
 * fails/loops out) -- a silent day is worse than a slightly wrong message.
 */
export async function runAgentTurn(params: {
  userId: string;
  trigger: AgentTrigger;
  goal: string;
  dateKey: string;
  explicitDislikedFoods: string[];
  /** planId to fall back to if the model never calls create/update_daily_plan (lunch/evening reuse an existing plan). */
  fallbackPlanId?: string;
}): Promise<AgentTurnResult> {
  const ctx = createToolCtx(params.userId, params.dateKey);
  if (params.fallbackPlanId) ctx.finalPlanId = params.fallbackPlanId;
  const mode = getAgentMode();

  if (mode === "mock") {
    return runMockCronTurn(params, ctx);
  }

  const steps: TraceStep[] = [];
  try {
    const tools = buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods });
    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: params.goal,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    collectStepsFromResult(result.steps, steps);

    let status: "complete" | "incomplete" = "complete";
    if (!ctx.finalMessageId) {
      status = "incomplete";
      const fallback = await messagingImpls.sendProactiveMessage(ctx, {
        planId: ctx.finalPlanId,
        type: TRIGGER_TO_MESSAGE_TYPE[params.trigger],
        text: "抱歉，今天这一步我想得有点久，先给你一个简单的安排，稍后可以再手动调整。",
        require: params.trigger === "evening" ? "CHECKIN" : "CONFIRM_OR_SWAP",
      });
      steps.push({ type: "tool_call", toolName: "send_proactive_message", input: { fallback: true } });
      steps.push({ type: "tool_result", toolName: "send_proactive_message", output: fallback });
    }

    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: status === "complete" ? "COMPLETE" : "INCOMPLETE",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
    });

    return { status, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
  } catch (err) {
    steps.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: "FAILED",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
    });
    return { status: "failed", finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
  }
}

/**
 * Action turn: only `swap` goes through the Agent (the one button click with
 * real judgment space -- picking among candidates). confirm/complete/skip
 * stay fully deterministic in lib/orchestrator/actions.ts and never reach
 * this function; they still log a trivial DETERMINISTIC trace via
 * `saveTrivialActionTrace` below so the /trace timeline stays consistent.
 */
export async function runActionTurn(params: {
  userId: string;
  trigger: ActionTrigger;
  goal: string;
  dateKey: string;
  explicitDislikedFoods: string[];
  planId: string;
}): Promise<AgentTurnResult> {
  const ctx = createToolCtx(params.userId, params.dateKey);
  ctx.finalPlanId = params.planId;
  const mode = getAgentMode();

  if (mode === "mock") {
    return runMockSwapTurn(params, ctx);
  }

  const steps: TraceStep[] = [];
  try {
    const tools = buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods });
    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: params.goal,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    collectStepsFromResult(result.steps, steps);

    // Swap turns don't send a message; "complete" means the plan actually changed meal.
    let status: "complete" | "incomplete" = "complete";
    if (!ctx.finalPlanId) {
      status = "incomplete";
    }

    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: status === "complete" ? "COMPLETE" : "INCOMPLETE",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
    });

    return { status, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
  } catch (err) {
    steps.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: "FAILED",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
    });
    return { status: "failed", finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
  }
}

/** confirm/complete/skip: no model call, just a trivial trace so /trace shows every action consistently. */
export async function saveTrivialActionTrace(params: {
  userId: string;
  trigger: "confirm" | "complete" | "skip";
  goal: string;
  planId?: string;
}) {
  return saveTrace({
    userId: params.userId,
    trigger: params.trigger,
    goal: params.goal,
    source: "DETERMINISTIC",
    status: "COMPLETE",
    steps: [{ type: "model_text", text: "无歧义的状态转移，未调用模型，直接由代码确定性写入。" }],
    planId: params.planId,
  });
}

function collectStepsFromResult(
  resultSteps: Array<{ text: string; toolCalls: Array<{ toolName: string; input: unknown }>; toolResults: Array<{ toolName: string; output: unknown }> }>,
  out: TraceStep[]
) {
  for (const step of resultSteps) {
    if (step.text) out.push({ type: "model_text", text: step.text });
    for (const call of step.toolCalls) {
      out.push({ type: "tool_call", toolName: call.toolName, input: call.input });
    }
    for (const res of step.toolResults) {
      out.push({ type: "tool_result", toolName: res.toolName, output: res.output });
    }
  }
}

// --- Mock mode: same tool implementations, no real LLM call. Dev-only. ---

async function runMockCronTurn(
  params: { userId: string; trigger: AgentTrigger; goal: string; dateKey: string; explicitDislikedFoods: string[]; fallbackPlanId?: string },
  ctx: ToolCtx
): Promise<AgentTurnResult> {
  const steps: TraceStep[] = [
    { type: "model_text", text: `[mock] ${params.trigger} 轮：无 DEEPSEEK_API_KEY，用确定性工具循环代替真实模型推理。` },
  ];

  if (params.trigger === "morning") {
    const candidates = await call(steps, "list_candidate_meals", () =>
      planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: params.explicitDislikedFoods })
    );
    const chosen = candidates[0];
    await call(steps, "create_daily_plan", () =>
      planningImpls.createDailyPlan(ctx, { type: "MORNING", mealKey: chosen?.mealKey })
    );
    await call(steps, "send_proactive_message", () =>
      messagingImpls.sendProactiveMessage(ctx, {
        planId: ctx.finalPlanId,
        type: "MORNING",
        text: `[mock] 午饭建议：${chosen?.title ?? "（候选为空）"}。确认还是换一个？`,
        require: "CONFIRM_OR_SWAP",
        payload: { mealKey: chosen?.mealKey },
      })
    );
  } else if (params.trigger === "lunch") {
    await call(steps, "send_proactive_message", () =>
      messagingImpls.sendProactiveMessage(ctx, {
        planId: ctx.finalPlanId,
        type: "LUNCH",
        text: "[mock] 中午提醒：吃了记得点一下完成，跳过也可以。",
        require: "CONFIRM_OR_SKIP",
      })
    );
  } else {
    await call(steps, "send_proactive_message", () =>
      messagingImpls.sendProactiveMessage(ctx, {
        planId: ctx.finalPlanId,
        type: "EVENING",
        text: "[mock] 晚间复盘：辛苦一天了，方便的话记一下体重。",
        require: "CHECKIN",
      })
    );
  }

  const trace = await saveTrace({
    userId: params.userId,
    trigger: params.trigger,
    goal: params.goal,
    source: "MOCK",
    status: "COMPLETE",
    steps,
    finalMessageId: ctx.finalMessageId,
    planId: ctx.finalPlanId,
  });
  return { status: "complete", finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
}

async function runMockSwapTurn(
  params: { userId: string; trigger: ActionTrigger; goal: string; dateKey: string; explicitDislikedFoods: string[]; planId: string },
  ctx: ToolCtx
): Promise<AgentTurnResult> {
  const steps: TraceStep[] = [
    { type: "model_text", text: "[mock] swap：无 DEEPSEEK_API_KEY，用确定性工具循环代替真实模型推理。" },
  ];

  const plan = await prisma.dailyPlan.findUnique({ where: { id: params.planId } });
  const oldMealKey = plan?.mealKey ?? undefined;

  const candidates = await call(steps, "list_candidate_meals", () =>
    planningImpls.listCandidateMeals(ctx, {
      explicitDislikedFoods: params.explicitDislikedFoods,
      excludeMealKeys: oldMealKey ? [oldMealKey] : [],
    })
  );
  const chosen = candidates[0];
  await call(steps, "update_daily_plan", () =>
    planningImpls.updateDailyPlan(ctx, { planId: params.planId, mealKey: chosen?.mealKey, status: "SWAPPED" })
  );
  if (oldMealKey) {
    await call(steps, "record_preference_signal", () =>
      memoryImpls.recordPreferenceSignal(ctx, { mealKey: oldMealKey, signal: "dislike" })
    );
  }

  const trace = await saveTrace({
    userId: params.userId,
    trigger: params.trigger,
    goal: params.goal,
    source: "MOCK",
    status: "COMPLETE",
    steps,
    finalMessageId: ctx.finalMessageId,
    planId: ctx.finalPlanId,
  });
  return { status: "complete", finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
}

async function call<T>(steps: TraceStep[], toolName: string, fn: () => Promise<T>): Promise<T> {
  const output = await fn();
  steps.push({ type: "tool_call", toolName, input: {} });
  steps.push({ type: "tool_result", toolName, output });
  return output;
}
