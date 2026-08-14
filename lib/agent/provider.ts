import { createDeepSeek } from "@ai-sdk/deepseek";

export type AgentMode = "real" | "mock";

/**
 * mock 仅用于离线开发（无网络 / 未配置 key）。最终 demo 必须用真实 key 跑
 * real 模式，否则 Trace 只是硬编码脚本，撑不住「Agent 深度」这个卖点。
 */
export function getAgentMode(): AgentMode {
  if (process.env.AGENT_MODE === "mock") return "mock";
  if (!process.env.DEEPSEEK_API_KEY) return "mock";
  return "real";
}

let deepseekProvider: ReturnType<typeof createDeepSeek> | null = null;

export function getModel() {
  if (!deepseekProvider) {
    deepseekProvider = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
  }
  // deepseek-chat/deepseek-reasoner 是已退役的旧别名（2026-07-24 起停用），
  // 现在的正式 model id 是 deepseek-v4-pro / deepseek-v4-flash。
  return deepseekProvider(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro");
}
