/**
 * Per-turn mutable context shared by all tools via closures. This is what
 * lets the tool layer enforce guardrails the prompt alone can't guarantee:
 * `list_candidate_meals` records which keys it handed out, and
 * `create_daily_plan` / `update_daily_plan` refuse any `mealKey` that isn't
 * in that set and revalidate the meal's availability and owner before writing.
 */
export type ToolCtx = {
  userId: string;
  dateKey: string;
  scenarioId: string;
  /** Absolute end of the user's local day. */
  dayEndsAt?: Date;
  /** Stable key used by cron-triggered final messages for DB-level idempotency. */
  messageDedupeKey?: string;
  /** The runner sets this; business clarification questions leave it unset. */
  trigger?: "morning" | "lunch" | "evening" | "swap";
  /** The old meal is excluded even when the model forgets excludeMealKeys. */
  swapMealKey?: string;
  /** Populated by list_candidate_meals; checked by create/update_daily_plan. */
  lastCandidateKeys: Set<string>;
  /** Set once a message/plan is produced, so the runner knows the turn's outcome. */
  finalMessageId?: string;
  finalPlanId?: string;
  planChanged: boolean;
  /**
   * Set by record_preference_signal. Lets the swap action verify the model
   * actually recorded the dislike signal and backfill it in code if not --
   * memory writes are too important to depend on prompt obedience.
   */
  recordedPreferenceSignal: boolean;
};

export function createToolCtx(
  userId: string,
  dateKey: string,
  options?: { dayEndsAt?: Date; messageDedupeKey?: string; scenarioId?: string }
): ToolCtx {
  return {
    userId,
    dateKey,
    scenarioId: options?.scenarioId ?? "weightloss",
    dayEndsAt: options?.dayEndsAt,
    messageDedupeKey: options?.messageDedupeKey,
    lastCandidateKeys: new Set(),
    planChanged: false,
    recordedPreferenceSignal: false,
  };
}
