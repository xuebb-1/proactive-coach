import * as Sentry from "@sentry/nextjs";
import { endOfDayForTimeZone } from "@/lib/date";
import {
  runEvening,
  runLunch,
  runMorning,
  type OrchestratorExecution,
} from "@/lib/orchestrator/daily-orchestrator";
import { getOnboardedUserById } from "@/lib/user";
import { inngest } from "../client";
import { dailyAgentEvent } from "../events";

export const runDailyAgent = inngest.createFunction(
  {
    id: "run-daily-agent",
    triggers: [dailyAgentEvent],
    retries: 3,
    idempotency: "event.data.dedupeKey",
    concurrency: [
      { limit: 5, scope: "env" },
      { limit: 1, key: "event.data.userId", scope: "env" },
    ],
  },
  async ({ event, step }) => {
    return step.run("execute-agent-turn", async () => {
      const user = await getOnboardedUserById(event.data.userId);
      if (!user) return { skipped: true, reason: "user_not_onboarded" };

      const execution: OrchestratorExecution = {
        now: new Date(event.data.scheduledAt),
        dateKey: event.data.dateKey,
        dayEndsAt: endOfDayForTimeZone(user.profile.timezone, new Date(event.data.scheduledAt)),
      };

      try {
        const handler = event.data.trigger === "morning"
          ? runMorning
          : event.data.trigger === "lunch" ? runLunch : runEvening;
        const result = await handler(user, execution);
        // A resolved promise without a persisted final message must remain retryable.
        if ("status" in result && result.status === "failed" && !result.finalMessageId) {
          throw new Error("Agent turn failed before delivery");
        }
        return result;
      } catch (error) {
        Sentry.captureException(error, {
          tags: { trigger: event.data.trigger, source: "inngest" },
          user: { id: user.id },
          extra: { dateKey: event.data.dateKey, dedupeKey: event.data.dedupeKey },
        });
        throw error;
      }
    });
  }
);
