import { generateText, stepCountIs } from "ai";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { getAgentMode, getModel, getModelId } from "./provider";
import { buildTools, createToolCtx, type ToolCtx } from "./tools";
import { memoryImpls } from "./tools/memory";
import { planningImpls } from "./tools/planning";
import { messagingImpls } from "./tools/messaging";
import { saveTrace, type TraceStep } from "./trace";
import { getScenario } from "@/lib/scenarios/registry";

export const STEP_BUDGETS: Record<AgentTrigger | ActionTrigger, number> = {
  morning: 6,
  lunch: 6,
  evening: 6,
  swap: 6,
};

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
  delivery: "agent" | "fallback" | "none";
  finalMessageId?: string;
  planId?: string;
  traceId: string;
  /** Whether record_preference_signal was actually called this turn (swap turns). */
  preferenceSignalRecorded?: boolean;
};

const FALLBACK_REQUIRE: Record<AgentTrigger, "CONFIRM_OR_SWAP" | "CONFIRM_OR_SKIP" | "CHECKIN"> = {
  morning: "CONFIRM_OR_SWAP",
  lunch: "CONFIRM_OR_SKIP",
  evening: "CHECKIN",
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
  dayEndsAt?: Date;
  dedupeKey?: string;
  scenarioId?: string;
}): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const ctx = createToolCtx(params.userId, params.dateKey, {
    dayEndsAt: params.dayEndsAt,
    messageDedupeKey: params.dedupeKey,
    scenarioId: params.scenarioId,
  });
  const scenario = getScenario(params.scenarioId);
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
      system: scenario.systemPrompt,
      prompt: params.goal,
      tools,
      stopWhen: stepCountIs(STEP_BUDGETS[params.trigger]),
    });

    collectStepsFromResult(result.steps, steps);

    let status: "complete" | "incomplete" = "complete";
    let delivery: "agent" | "fallback" = "agent";
    if (!ctx.finalMessageId) {
      status = "incomplete";
      delivery = "fallback";
      await sendCronFallback(params, ctx, steps);
    }

    const usage = result.usage as { inputTokens?: number; outputTokens?: number };
    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: status === "complete" ? "COMPLETE" : "INCOMPLETE",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
      durationMs: Date.now() - startedAt,
      stepCount: result.steps.length,
      model: getModelId(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      delivery,
    });

    return { status, delivery, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
  } catch (err) {
    Sentry.captureException(err, { tags: { trigger: params.trigger, layer: "agent-runner" }, user: { id: params.userId } });
    steps.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    let delivery: "fallback" | "none" = "none";
    try {
      await sendCronFallback(params, ctx, steps);
      delivery = "fallback";
    } catch (fallbackError) {
      steps.push({
        type: "error",
        message: `fallback_failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      });
    }
    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: "FAILED",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
      durationMs: Date.now() - startedAt,
      stepCount: steps.filter((step) => step.type === "tool_call").length,
      model: getModelId(),
      delivery,
      failureKind: classifyFailure(err),
    });
    return { status: "failed", delivery, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
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
  previousMealKey: string;
  dayEndsAt?: Date;
  scenarioId?: string;
}): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const ctx = createToolCtx(params.userId, params.dateKey, {
    dayEndsAt: params.dayEndsAt,
    scenarioId: params.scenarioId,
  });
  const scenario = getScenario(params.scenarioId);
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
      system: scenario.systemPrompt,
      prompt: params.goal,
      tools,
      stopWhen: stepCountIs(STEP_BUDGETS[params.trigger]),
    });

    collectStepsFromResult(result.steps, steps);

    // Swap turns don't send a message; complete means the persisted meal actually changed.
    const persistedPlan = await prisma.dailyPlan.findUnique({
      where: { id: params.planId },
      select: { mealKey: true },
    });
    const status: "complete" | "incomplete" =
      persistedPlan?.mealKey && persistedPlan.mealKey !== params.previousMealKey ? "complete" : "incomplete";

    const usage = result.usage as { inputTokens?: number; outputTokens?: number };
    const trace = await saveTrace({
      userId: params.userId,
      trigger: params.trigger,
      goal: params.goal,
      source: "REAL",
      status: status === "complete" ? "COMPLETE" : "INCOMPLETE",
      steps,
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
      durationMs: Date.now() - startedAt,
      stepCount: result.steps.length,
      model: getModelId(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      delivery: "none",
    });

    return {
      status,
      delivery: "none",
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
      traceId: trace.id,
      preferenceSignalRecorded: ctx.recordedPreferenceSignal,
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { trigger: params.trigger, layer: "agent-runner" }, user: { id: params.userId } });
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
      durationMs: Date.now() - startedAt,
      stepCount: steps.filter((step) => step.type === "tool_call").length,
      model: getModelId(),
      delivery: "none",
      failureKind: classifyFailure(err),
    });
    return {
      status: "failed",
      delivery: "none",
      finalMessageId: ctx.finalMessageId,
      planId: ctx.finalPlanId,
      traceId: trace.id,
      preferenceSignalRecorded: ctx.recordedPreferenceSignal,
    };
  }
}

/**
 * Deterministic-path traces: confirm/complete/skip never call the model, and
 * swap uses this too when the Agent turn fails and code falls back to the
 * rule-based picker -- so /trace shows every action consistently.
 */
export async function saveTrivialActionTrace(params: {
  userId: string;
  trigger: "confirm" | "complete" | "skip" | "swap";
  goal: string;
  planId?: string;
}) {
  return saveTrace({
    userId: params.userId,
    trigger: params.trigger,
    goal: params.goal,
    source: "DETERMINISTIC",
    status: "COMPLETE",
    steps: [{ type: "model_text", text: "未调用模型，由代码确定性写入。" }],
    planId: params.planId,
    delivery: "deterministic",
    durationMs: 0,
    stepCount: 0,
    model: "deterministic",
  });
}

async function sendCronFallback(
  params: {
    userId: string;
    trigger: AgentTrigger;
    dateKey: string;
    explicitDislikedFoods: string[];
  },
  ctx: ToolCtx,
  steps: TraceStep[]
) {
  if (ctx.finalMessageId) return;

  if (params.trigger === "morning" && !ctx.finalPlanId) {
    const candidates = await planningImpls.listCandidateMeals(ctx, {
      explicitDislikedFoods: params.explicitDislikedFoods,
    });
    const chosen = candidates[0];
    if (!chosen) throw new Error("fallback_no_candidate_meal");
    steps.push({ type: "tool_call", toolName: "list_candidate_meals", input: { fallback: true } });
    steps.push({ type: "tool_result", toolName: "list_candidate_meals", output: candidates });

    const plan = await planningImpls.createDailyPlan(ctx, {
      type: "MORNING",
      mealKey: chosen.mealKey,
    });
    steps.push({ type: "tool_call", toolName: "create_daily_plan", input: { fallback: true, mealKey: chosen.mealKey } });
    steps.push({ type: "tool_result", toolName: "create_daily_plan", output: plan });
  }

  if (!ctx.finalPlanId) throw new Error("fallback_missing_plan");

  const textByTrigger: Record<AgentTrigger, string> = {
    morning: "今天先给你一个稳妥的午饭安排，确认后照着执行；不合适也可以换一个。",
    lunch: "中午提醒：按早上的计划吃，完成后记得回来打个勾；临时有变化也可以跳过。",
    evening: "辛苦一天了，方便的话记录一下今天的体重，我们明天继续调整。",
  };
  const fallback = await messagingImpls.sendProactiveMessage(ctx, {
    planId: ctx.finalPlanId,
    type: TRIGGER_TO_MESSAGE_TYPE[params.trigger],
    text: textByTrigger[params.trigger],
    require: FALLBACK_REQUIRE[params.trigger],
    payload: { fallback: true },
  });
  steps.push({ type: "tool_call", toolName: "send_proactive_message", input: { fallback: true } });
  steps.push({ type: "tool_result", toolName: "send_proactive_message", output: fallback });
}

function classifyFailure(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/timeout|timed out|abort/i.test(message)) return "model_timeout";
  if (/invalid_meal_key|plan_not_found|tool/i.test(message)) return "tool_error";
  if (/fallback_/i.test(message)) return "fallback_error";
  return "model_or_provider_error";
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
    stepCount: steps.filter((step) => step.type === "tool_call").length,
    delivery: "agent",
    durationMs: 0,
    model: "mock",
  });
  return {
    status: "complete",
    delivery: "agent",
    finalMessageId: ctx.finalMessageId,
    planId: ctx.finalPlanId,
    traceId: trace.id,
  };
}

async function runMockSwapTurn(
  params: {
    userId: string;
    trigger: ActionTrigger;
    goal: string;
    dateKey: string;
    explicitDislikedFoods: string[];
    planId: string;
    previousMealKey: string;
  },
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

  const status = chosen?.mealKey && chosen.mealKey !== params.previousMealKey ? "complete" : "incomplete";
  const trace = await saveTrace({
    userId: params.userId,
    trigger: params.trigger,
    goal: params.goal,
    source: "MOCK",
    status: status === "complete" ? "COMPLETE" : "INCOMPLETE",
    steps,
    finalMessageId: ctx.finalMessageId,
    planId: ctx.finalPlanId,
    stepCount: steps.filter((step) => step.type === "tool_call").length,
    delivery: "none",
    durationMs: 0,
    model: "mock",
  });
  return {
    status,
    delivery: "none",
    finalMessageId: ctx.finalMessageId,
    planId: ctx.finalPlanId,
    traceId: trace.id,
    preferenceSignalRecorded: ctx.recordedPreferenceSignal,
  };
}

async function call<T>(steps: TraceStep[], toolName: string, fn: () => Promise<T>): Promise<T> {
  const output = await fn();
  steps.push({ type: "tool_call", toolName, input: {} });
  steps.push({ type: "tool_result", toolName, output });
  return output;
}
