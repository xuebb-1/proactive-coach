import { cron } from "inngest";
import { prisma } from "@/lib/db";
import { findDueAgentTriggers } from "@/lib/scheduling/due-users";
import { getAsyncAgentMode } from "@/lib/scheduling/mode";
import { inngest } from "../client";
import { dailyAgentEvent } from "../events";

export const scheduleDailyAgents = inngest.createFunction(
  {
    id: "schedule-daily-agents",
    triggers: [cron("*/5 * * * *")],
  },
  async ({ event, step }) => {
    const mode = getAsyncAgentMode();
    if (mode === "disabled") {
      return { disabled: true };
    }

    const now = new Date(event.ts);
    const due = await step.run("find-due-users", async () => {
      const profiles = await prisma.userProfile.findMany({
        select: {
          userId: true,
          timezone: true,
          morningTime: true,
          lunchTime: true,
          eveningTime: true,
        },
      });
      return findDueAgentTriggers(profiles, now);
    });

    if (mode === "shadow" || due.length === 0) {
      return { shadow: mode === "shadow", due };
    }

    await step.sendEvent(
      "dispatch-due-agent-triggers",
      due.map((item) => dailyAgentEvent.create(item, { id: item.dedupeKey }))
    );
    return { dispatched: due.length };
  }
);
