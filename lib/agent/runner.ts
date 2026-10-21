import { generateText, stepCountIs } from "ai";
import { prisma } from "@/lib/db";
import { getAgentMode, getModel } from "./provider";
import { buildTools, createToolCtx, type ToolCtx } from "./tools";
import { planningImpls } from "./tools/planning";
import { messagingImpls } from "./tools/messaging";
import { SYSTEM_PROMPT } from "./prompts";
import { saveTrace, type TraceStep } from "./trace";

const MAX_STEPS = 6;
export type AgentTrigger = "morning" | "lunch" | "evening";
export type ActionTrigger = "swap";
export type AgentTurnResult = {
  status: "complete" | "incomplete" | "failed";
  finalMessageId?: string; planId?: string; traceId: string; preferenceSignalRecorded?: boolean;
};
type CronParams = {
  userId: string; trigger: AgentTrigger; goal: string; dateKey: string;
  explicitDislikedFoods: string[]; fallbackPlanId?: string;
};

async function fallbackMessage(params: CronParams, ctx: ToolCtx) {
  let text = "";
  let require: "CONFIRM_OR_SWAP" | "CONFIRM_OR_SKIP" | "CHECKIN" | "NONE" = "NONE";
  if (params.trigger === "morning") {
    if (!ctx.finalPlanId) {
      const candidates = await planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: params.explicitDislikedFoods });
      if (candidates[0]) await planningImpls.createDailyPlan(ctx, { type: "MORNING", mealKey: candidates[0].mealKey });
    }
    const plan = ctx.finalPlanId ? await prisma.dailyPlan.findUnique({ where: { id: ctx.finalPlanId } }) : null;
    if (plan?.mealKey) {
      text = `今天先采用备用安排：${plan.mealTitle}。你可以确认或换一个。`;
      require = "CONFIRM_OR_SWAP";
    } else {
      text = "目前没有符合忌口的可用方案，请在菜品库补充或启用其他方案后再安排。";
    }
  } else if (params.trigger === "lunch") {
    text = "午饭时间到了，完成后记一下；今天不方便也可以选择跳过。";
    require = "CONFIRM_OR_SKIP";
  } else {
    text = "今天辛苦了，方便的话记录一下体重。未反馈的午饭安排会保留为未反馈。";
    require = "CHECKIN";
  }
  return messagingImpls.sendProactiveMessage(ctx, {
    planId: ctx.finalPlanId, type: params.trigger.toUpperCase() as "MORNING" | "LUNCH" | "EVENING", text, require,
  });
}

export async function runAgentTurn(params: CronParams): Promise<AgentTurnResult> {
  const ctx = createToolCtx(params.userId, params.dateKey);
  ctx.trigger = params.trigger;
  ctx.finalPlanId = params.fallbackPlanId;
  const mode = getAgentMode();
  const steps: TraceStep[] = [];
  let status: AgentTurnResult["status"] = "complete";
  try {
    if (mode === "mock") {
      steps.push({ type: "model_text", text: "[mock] 使用确定性备用流程，不调用真实模型。" });
      await fallbackMessage(params, ctx);
    } else {
      await generateText({
        model: getModel(), system: SYSTEM_PROMPT, prompt: params.goal,
        tools: buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods }),
        stopWhen: stepCountIs(MAX_STEPS), maxRetries: 1, abortSignal: AbortSignal.timeout(90000),
        onStepFinish: (step) => collectStep(step, steps),
      });
      if (!ctx.finalMessageId) {
        status = "incomplete";
        await fallbackMessage(params, ctx);
        steps.push({ type: "tool_result", toolName: "fallback_message", output: { messageId: ctx.finalMessageId } });
      }
    }
  } catch (error) {
    status = "incomplete";
    steps.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
    try {
      if (!ctx.finalMessageId) await fallbackMessage(params, ctx);
      steps.push({ type: "tool_result", toolName: "fallback_message", output: { messageId: ctx.finalMessageId } });
    } catch (fallbackError) {
      status = "failed";
      steps.push({ type: "error", message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
    }
  }
  const trace = await saveTrace({
    userId: params.userId, trigger: params.trigger, goal: params.goal,
    source: mode === "mock" ? "MOCK" : "REAL",
    status: status === "complete" ? "COMPLETE" : status === "incomplete" ? "INCOMPLETE" : "FAILED",
    steps, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId,
  });
  return { status, traceId: trace.id, finalMessageId: ctx.finalMessageId, planId: ctx.finalPlanId };
}

export async function runActionTurn(params: {
  userId: string; trigger: ActionTrigger; goal: string; dateKey: string;
  explicitDislikedFoods: string[]; planId: string; oldMealKey: string;
}): Promise<AgentTurnResult> {
  const ctx = createToolCtx(params.userId, params.dateKey);
  ctx.trigger = "swap";
  ctx.swapMealKey = params.oldMealKey;
  ctx.finalPlanId = params.planId;
  const mode = getAgentMode();
  const steps: TraceStep[] = [];
  let status: AgentTurnResult["status"] = "complete";
  try {
    if (mode === "mock") {
      const candidates = await planningImpls.listCandidateMeals(ctx, { explicitDislikedFoods: params.explicitDislikedFoods });
      if (!candidates[0]) throw new Error("没有可替换的方案，请在菜品库补充符合忌口的其他方案。");
      await planningImpls.updateDailyPlan(ctx, { planId: params.planId, mealKey: candidates[0].mealKey, status: "SWAPPED" });
      steps.push({ type: "model_text", text: "[mock] 从候选中选择替代方案。" });
    } else {
      await generateText({
        model: getModel(), system: SYSTEM_PROMPT, prompt: params.goal,
        tools: buildTools(ctx, { explicitDislikedFoods: params.explicitDislikedFoods }),
        stopWhen: stepCountIs(MAX_STEPS), maxRetries: 1, abortSignal: AbortSignal.timeout(90000),
        onStepFinish: (step) => collectStep(step, steps),
      });
    }
    const plan = await prisma.dailyPlan.findUnique({ where: { id: params.planId } });
    if (!plan?.mealKey || plan.mealKey === params.oldMealKey) status = "incomplete";
  } catch (error) {
    status = "failed";
    steps.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
  const trace = await saveTrace({
    userId: params.userId, trigger: "swap", goal: params.goal, source: mode === "mock" ? "MOCK" : "REAL",
    status: status === "complete" ? "COMPLETE" : status === "incomplete" ? "INCOMPLETE" : "FAILED",
    steps, planId: params.planId,
  });
  return { status, planId: params.planId, traceId: trace.id, preferenceSignalRecorded: ctx.recordedPreferenceSignal };
}

export async function saveTrivialActionTrace(params: {
  userId: string; trigger: "confirm" | "complete" | "skip" | "swap"; goal: string; planId?: string;
}) {
  return saveTrace({ ...params, source: "DETERMINISTIC", status: "COMPLETE",
    steps: [{ type: "model_text", text: "由业务代码写入，未调用模型。" }] });
}

function collectStep(step: {
  text: string; toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
}, steps: TraceStep[]) {
  if (step.text) steps.push({ type: "model_text", text: step.text });
  for (const call of step.toolCalls) steps.push({ type: "tool_call", toolName: call.toolName, input: call.input });
  for (const result of step.toolResults) steps.push({ type: "tool_result", toolName: result.toolName, output: result.output });
}
