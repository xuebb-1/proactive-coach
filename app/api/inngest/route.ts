import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { runDailyAgent } from "@/lib/inngest/functions/agent-trigger";
import { scheduleDailyAgents } from "@/lib/inngest/functions/scheduler";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduleDailyAgents, runDailyAgent],
});
