import { buildMemoryTools } from "./memory";
import { buildPlanningTools } from "./planning";
import { buildMessagingTools } from "./messaging";
import type { ToolCtx } from "./context";

export { createToolCtx, type ToolCtx } from "./context";

export function buildTools(ctx: ToolCtx, opts: { explicitDislikedFoods: string[] }) {
  return {
    ...buildMemoryTools(ctx),
    ...buildPlanningTools(ctx, opts),
    ...buildMessagingTools(ctx),
  };
}
