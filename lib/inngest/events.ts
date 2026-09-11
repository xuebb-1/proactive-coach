import { eventType } from "inngest";
import { z } from "zod";

export const dailyAgentEvent = eventType("agent/daily-trigger", {
  schema: z.object({
    userId: z.string().min(1),
    trigger: z.enum(["morning", "lunch", "evening"]),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledAt: z.string().datetime(),
    dedupeKey: z.string().min(1),
  }),
});
