import { prisma } from "@/lib/db";
import type { AgentTraceSource, AgentTraceStatus } from "@/app/generated/prisma/client";

export type TraceStep =
  | { type: "model_text"; text: string }
  | { type: "tool_call"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: unknown }
  | { type: "final_message"; messageId: string; text: string }
  | { type: "error"; message: string };

export async function saveTrace(opts: {
  userId: string;
  trigger: string;
  goal: string;
  source: AgentTraceSource;
  status?: AgentTraceStatus;
  steps: TraceStep[];
  finalMessageId?: string | null;
  planId?: string | null;
}) {
  return prisma.agentTrace.create({
    data: {
      userId: opts.userId,
      trigger: opts.trigger,
      goal: opts.goal,
      source: opts.source,
      status: opts.status ?? "COMPLETE",
      steps: JSON.stringify(opts.steps),
      finalMessageId: opts.finalMessageId ?? undefined,
      planId: opts.planId ?? undefined,
    },
  });
}

export type ParsedTrace = Awaited<ReturnType<typeof prisma.agentTrace.findMany>>[number] & {
  parsedSteps: TraceStep[];
};

export function parseTraceSteps(steps: string): TraceStep[] {
  try {
    return JSON.parse(steps) as TraceStep[];
  } catch {
    return [];
  }
}
