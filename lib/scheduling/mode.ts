export type AsyncAgentMode = "disabled" | "shadow" | "live";

export function getAsyncAgentMode(env: Record<string, string | undefined> = process.env): AsyncAgentMode {
  if (env.ASYNC_AGENT_ENABLED !== "true") return "disabled";
  if (env.ASYNC_AGENT_SHADOW === "true") return "shadow";
  return "live";
}
