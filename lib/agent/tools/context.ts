/**
 * Per-turn mutable context shared by all tools via closures. This is what
 * lets the tool layer enforce guardrails the prompt alone can't guarantee:
 * `list_candidate_meals` records which keys it handed out, and
 * `create_daily_plan` / `update_daily_plan` refuse any `mealKey` that isn't
 * in that set (or in the static recipe library as a last-resort check).
 */
export type ToolCtx = {
  userId: string;
  dateKey: string;
  /** Populated by list_candidate_meals; checked by create/update_daily_plan. */
  lastCandidateKeys: Set<string>;
  /** Set once a message/plan is produced, so the runner knows the turn's outcome. */
  finalMessageId?: string;
  finalPlanId?: string;
};

export function createToolCtx(userId: string, dateKey: string): ToolCtx {
  return { userId, dateKey, lastCandidateKeys: new Set() };
}
