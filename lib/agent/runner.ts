import { generateText, isStepCount } from "ai";
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
  morning: "MORNING", lunch: "LUNCH", evening: "EVENING",
};
const FALLBACK_REQUIRE = {
  morning: "CONFIRM_OR_SWAP", lunch: "CONFIRM_OR_SKIP", evening: "CHECKIN",
} as const;

export type AgentTurnResult = {
  status: "complete" | "incomplete" | "failed";
  delivery: "agent" | "fallback" | "none";
  finalMessageId?: string;
  planId?: string;
  traceId: string;
  /** Whether record_preference_signal was actually called this turn (swap turns). */
  preferenceSignalRecorded?: boolean;
};

type CronParams = {
  userId: string;
  trigger: AgentTrigger;
  goal: string;
  dateKey: string;
  explicitDislikedFoods: string[];
  fallbackPlanId?: string;
  dayEndsAt?: Date;
  dedupeKey?: string;
  scenarioId?: string;
};
type ActionParams = {
  userId: string;
  trigger: ActionTrigger;
  goal: string;
  dateKey: string;
  explicitDislikedFoods: string[];
  planId: string;
  previousMealKey: string;
  dayEndsAt?: Date;
  scenarioId?: string;
};
type Usage = { inputTokens?: number; outputTokens?: number };
type ModelStep = {
  text: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
  usage?: Usage;
  content?: Array<{ type: string; toolName?: string; error?: unknown }>;
};
type Evidence = { steps: TraceStep[]; stepCount: number; usage: Usage };

/** Daily turns must persist a final message, including a safe deterministic fallback. */
export async function runAgentTurn(params: CronParams): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const ctx = createToolCtx(params.userId, params.dateKey, {
    dayEndsAt: params.dayEndsAt, messageDedupeKey: params.dedupeKey, scenarioId: params.scenarioId,
  });
  ctx.trigger = params.trigger;
  ctx.finalPlanId = params.fallbackPlanId;
  const mode = getAgentMode();
  const evidence: Evidence = { steps: [], stepCount: 0, usage: {} };
  let status: AgentTurnResult["status"] = "complete";
  let delivery: AgentTurnResult["delivery"] = "none";
  let failureKind: string | undefined;

  try {
    if (mode === "mock") {
      evidence.steps.push({ type: "model_text", text: `[mock] ${params.trigger}：使用确定性工具流程，不调用模型。` });
      await sendCronFallback(params, ctx, evidence.steps, true);
      delivery = "agent";
    } else {
      const result = await generateText({
        model: getModel(),
        system: getScenario(params.scenarioId).systemPrompt,
        prompt: params.goal,
        tools: buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods }),
        stopWhen: [isStepCount(STEP_BUDGETS[params.trigger]), () => Boolean(ctx.finalMessageId)],
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90000),
        // Save each completed step immediately, so provider failures retain earlier evidence.
        onStepEnd: (step) => collectStep(step, evidence),
      });
      collectResult(result, evidence);
      if (ctx.finalMessageId) {
        delivery = "agent";
      } else {
        status = "incomplete";
        failureKind = "no_final_message";
        await sendCronFallback(params, ctx, evidence.steps);
        delivery = "fallback";
      }
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { trigger: params.trigger, layer: "agent-runner" }, user: { id: params.userId } });
    evidence.steps.push({ type: "error", message: errorMessage(error) });
    failureKind = classifyFailure(error);
    status = "incomplete";
    // A later model error must never replace a message that already committed.
    if (ctx.finalMessageId) {
      if (delivery === "none") delivery = "agent";
    } else {
      try {
        await sendCronFallback(params, ctx, evidence.steps);
        delivery = "fallback";
      } catch (fallbackError) {
        status = "failed";
        evidence.steps.push({ type: "error", message: `fallback_failed: ${errorMessage(fallbackError)}` });
      }
    }
  }

  const trace = await saveTrace({
    userId: params.userId, trigger: params.trigger, goal: params.goal,
    source: mode === "mock" ? "MOCK" : "REAL", status: traceStatus(status),
    steps: evidence.steps, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId,
    durationMs: Date.now() - startedAt, stepCount: modelStepCount(mode, evidence),
    model: mode === "mock" ? "mock" : getModelId(), ...evidence.usage, delivery, failureKind,
  });
  return { status, delivery, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId, traceId: trace.id };
}

/** Only swap requires model judgment; other button actions stay deterministic. */
export async function runActionTurn(params: ActionParams): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const ctx = createToolCtx(params.userId, params.dateKey, {
    dayEndsAt: params.dayEndsAt, scenarioId: params.scenarioId,
  });
  ctx.trigger = "swap";
  ctx.swapMealKey = params.previousMealKey;
  ctx.finalPlanId = params.planId;
  const mode = getAgentMode();
  const evidence: Evidence = { steps: [], stepCount: 0, usage: {} };
  let status: AgentTurnResult["status"] = "complete";
  let failureKind: string | undefined;

  try {
    if (mode === "mock") {
      evidence.steps.push({ type: "model_text", text: "[mock] swap：从符合忌口的候选中选择替代方案。" });
      const candidates = await call(evidence.steps, "list_candidate_meals", {}, () =>
        planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: params.explicitDislikedFoods })
      );
      const chosen = candidates[0];
      if (!chosen) throw new Error("没有可替换的方案，请在菜品库补充符合忌口的其他方案。");
      await call(evidence.steps, "update_daily_plan", { planId: params.planId, mealKey: chosen.mealKey, status: "SWAPPED" }, () =>
        planningImpls.updateDailyPlan(ctx, { planId: params.planId, mealKey: chosen.mealKey, status: "SWAPPED" })
      );
      await call(evidence.steps, "record_preference_signal", { mealKey: params.previousMealKey, signal: "dislike" }, () =>
        memoryImpls.recordPreferenceSignal(ctx, { mealKey: params.previousMealKey, signal: "dislike" })
      );
    } else {
      const result = await generateText({
        model: getModel(),
        system: getScenario(params.scenarioId).systemPrompt,
        prompt: params.goal,
        tools: buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods }),
        stopWhen: isStepCount(STEP_BUDGETS[params.trigger]),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90000),
        onStepEnd: (step) => collectStep(step, evidence),
      });
      collectResult(result, evidence);
    }
    // Completion is based on persisted state, not the model's claim or a tool call.
    const plan = await prisma.dailyPlan.findUnique({
      where: { id: params.planId, userId: params.userId, date: params.dateKey }, select: { mealKey: true },
    });
    if (!plan?.mealKey || plan.mealKey === params.previousMealKey) status = "incomplete";
  } catch (error) {
    Sentry.captureException(error, { tags: { trigger: params.trigger, layer: "agent-runner" }, user: { id: params.userId } });
    status = "failed";
    failureKind = classifyFailure(error);
    evidence.steps.push({ type: "error", message: errorMessage(error) });
  }

  const trace = await saveTrace({
    userId: params.userId, trigger: params.trigger, goal: params.goal,
    source: mode === "mock" ? "MOCK" : "REAL", status: traceStatus(status),
    steps: evidence.steps, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId,
    durationMs: Date.now() - startedAt, stepCount: modelStepCount(mode, evidence),
    model: mode === "mock" ? "mock" : getModelId(), ...evidence.usage, delivery: "none", failureKind,
  });
  return {
    status, delivery: "none", finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId,
    traceId: trace.id, preferenceSignalRecorded: ctx.recordedPreferenceSignal,
  };
}

export async function saveTrivialActionTrace(params: {
  userId: string; trigger: "confirm" | "complete" | "skip" | "swap"; goal: string; planId?: string;
}) {
  return saveTrace({
    ...params, source: "DETERMINISTIC", status: "COMPLETE",
    steps: [{ type: "model_text", text: "未调用模型，由代码确定性写入。" }],
    delivery: "deterministic", durationMs: 0, stepCount: 0, model: "deterministic",
  });
}

async function sendCronFallback(params: CronParams, ctx: ToolCtx, steps: TraceStep[], mock = false) {
  if (ctx.finalMessageId) return;
  if (params.trigger === "morning" && !ctx.finalPlanId) {
    const candidates = await call(steps, "list_candidate_meals", { fallback: !mock }, () =>
      planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: params.explicitDislikedFoods })
    );
    const chosen = candidates[0];
    if (chosen) await call(steps, "create_daily_plan", { type: "MORNING", mealKey: chosen.mealKey }, () =>
      planningImpls.createDailyPlan(ctx, { type: "MORNING", mealKey: chosen.mealKey })
    );
  }

  const type = TRIGGER_TO_MESSAGE_TYPE[params.trigger];
  const plan = ctx.finalPlanId ? await prisma.dailyPlan.findUnique({
    where: { id: ctx.finalPlanId, userId: ctx.userId, date: ctx.dateKey, type: type === "EVENING" ? "EVENING" : "MORNING" },
  }) : null;
  // A missing plan is a valid no-action message, never a button linked to a fabricated plan.
  if (!plan) ctx.finalPlanId = undefined;
  const terminal = plan && ["COMPLETED", "SKIPPED", "EXPIRED", "NO_RESPONSE", "AUTO_ACCEPTED"].includes(plan.status);
  const expired = plan?.expiresAt && plan.expiresAt <= new Date();
  let require: "CONFIRM_OR_SWAP" | "CONFIRM_OR_SKIP" | "CHECKIN" | "NONE" = "NONE";
  let text: string;
  if (params.trigger === "morning") {
    if (plan?.mealKey && !terminal && !expired) {
      require = FALLBACK_REQUIRE.morning;
      text = `今天的午饭安排：${plan.mealTitle ?? plan.mealKey}。确认后照着执行；不合适也可以换一个。`;
    } else if (plan?.mealKey) {
      text = `今天的午饭安排已有记录：${plan.mealTitle ?? plan.mealKey}。`;
    } else {
      text = "目前没有符合忌口的可用方案，请在菜品库补充或启用其他方案后再安排。";
    }
  } else if (params.trigger === "lunch") {
    if (plan && !terminal && !expired && plan.mealKey) {
      require = FALLBACK_REQUIRE.lunch;
      text = "中午提醒：按早上的计划吃，完成后记得回来打个勾；临时有变化也可以跳过。";
    } else {
      text = plan ? "今天的午饭安排已有记录，明天继续按自己的节奏来。" : "今天还没有可执行的午饭安排，请先补充符合忌口的方案。";
    }
  } else {
    if (plan && !terminal && !expired) require = FALLBACK_REQUIRE.evening;
    text = require === "CHECKIN"
      ? "辛苦一天了，方便的话记录一下今天的体重。未反馈的午饭安排会保留为未反馈。"
      : "今天辛苦了，我们明天继续按自己的节奏来。";
  }
  const args = {
    planId: ctx.finalPlanId, type, text: mock ? `[mock] ${text}` : text, require,
    payload: mock ? {} : { fallback: true },
  };
  await call(steps, "send_proactive_message", args, () => messagingImpls.sendProactiveMessage(ctx, args));
}

function collectStep(step: ModelStep, evidence: Evidence) {
  evidence.stepCount += 1;
  if (step.text) evidence.steps.push({ type: "model_text", text: step.text });
  for (const call of step.toolCalls) evidence.steps.push({ type: "tool_call", toolName: call.toolName, input: call.input });
  for (const result of step.toolResults) evidence.steps.push({ type: "tool_result", toolName: result.toolName, output: result.output });
  for (const item of step.content ?? []) {
    if (item.type === "tool-error") evidence.steps.push({ type: "error", message: `${item.toolName}: ${errorMessage(item.error)}` });
  }
  for (const key of ["inputTokens", "outputTokens"] as const) {
    if (step.usage?.[key] !== undefined) evidence.usage[key] = (evidence.usage[key] ?? 0) + step.usage[key];
  }
}

function collectResult(result: { steps: ModelStep[]; usage: Usage }, evidence: Evidence) {
  // Test doubles and providers without step callbacks can still report final steps.
  if (!evidence.stepCount) for (const step of result.steps) collectStep(step, evidence);
  for (const key of ["inputTokens", "outputTokens"] as const) {
    if (result.usage[key] !== undefined) evidence.usage[key] = result.usage[key];
  }
}

function modelStepCount(mode: string, evidence: Evidence) {
  return mode === "mock" ? evidence.steps.filter((step) => step.type === "tool_call").length : evidence.stepCount;
}
function traceStatus(status: AgentTurnResult["status"]) {
  return status === "complete" ? "COMPLETE" : status === "incomplete" ? "INCOMPLETE" : "FAILED";
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function classifyFailure(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/timeout|timed out|abort/i.test(message)) return "model_timeout";
  if (/invalid_meal_key|plan_not_found|tool/i.test(message)) return "tool_error";
  if (/fallback_/i.test(message)) return "fallback_error";
  return "model_or_provider_error";
}

async function call<T>(steps: TraceStep[], toolName: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  steps.push({ type: "tool_call", toolName, input });
  const output = await fn();
  steps.push({ type: "tool_result", toolName, output });
  return output;
}
