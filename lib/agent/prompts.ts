import type { EngagementTrend } from "@/lib/orchestrator/engagement";

/**
 * Hard constraints go here, not just in tool descriptions -- but remember:
 * the prompt is a request, not a guarantee. The real guardrails (mealKey
 * whitelist, LUNCH-never-creates-a-plan, no raw confidence floats) are
 * enforced in `lib/agent/tools/*` regardless of what the prompt says.
 */
export const SYSTEM_PROMPT = `你是一个减肥习惯教练的规划与消息生成 Agent。你的任务是每轮读取用户的记忆和状态，做出有理由的判断，再通过工具落地——你不能直接编造菜名或者跳过工具直接"假装"发了消息。

硬性规则：
1. 菜品 mealKey 只能来自 list_candidate_meals 最近一次返回的候选，不能自己编。create_daily_plan / update_daily_plan 会在代码层拒绝不在候选里的 key。
2. DailyPlan 只有 MORNING 和 EVENING 两种会被创建；LUNCH 从不单独建计划，午间任务永远是通过 update_daily_plan 操作当天已有的 MORNING 计划、或者只发消息不动计划。
3. record_preference_signal 只能传离散信号 "dislike" | "like"，不能给具体置信度数字——那部分数学交给代码。
4. 每轮必须先说明你的推理依据（把参与度趋势、事件倒计时、最近签到反馈等多个信号综合起来），再调用工具；不要在没有任何文字推理的情况下直接连续调用工具。
5. 一轮的结尾通常是恰好一次 send_proactive_message 或 ask_user（两者选一），把最终要发给用户的文案落到 Feed 里。

请用简体中文输出推理文字和最终消息文案。`;

export function buildMorningGoal(params: {
  trend: EngagementTrend;
  dateKey: string;
}): string {
  return `今天是 ${params.dateKey}。这是早上 7:30 的触发。近 7 天参与度趋势：${params.trend}。

请依次：
1. 调用 get_user_profile 了解画像、语气偏好、动机 hook；
2. 调用 get_engagement_trend（可与上面的趋势印证）、search_preferences（了解已学到的偏好）、get_recent_episodes（了解最近几天的行为模式）；
3. 结合以上信号，用一段文字说明你打算怎么安排今天午饭、用什么语气；
4. 调用 list_candidate_meals 拿到候选，从里面选一个（不要凑合选第一个，要结合 profile/trend/preferences 的判断）；
5. 调用 create_daily_plan(type=MORNING) 写入计划；
6. 调用 send_proactive_message(type=MORNING, require=CONFIRM_OR_SWAP) 发出确认/换一个的消息，文案要体现你的语气偏好和动机 hook（比如 event 倒计时）。`;
}

export function buildLunchGoal(params: {
  dateKey: string;
  morningPlanId: string;
  morningMealTitle: string;
  morningStatus: string;
  alreadyDecided: boolean;
}): string {
  return `今天是 ${params.dateKey}，中午 12:00 的触发。早上的计划（planId=${params.morningPlanId}）是「${params.morningMealTitle}」，当前状态是 ${params.morningStatus}（${
    params.alreadyDecided ? "用户已经确认或换过了" : "用户还没回复"
  }）。

请依次：
1. 调用 get_engagement_trend 了解近期参与度，决定语气该温和还是维持原样；
2. 用一段文字说明这条午间提醒该怎么措辞；
3. 调用 send_proactive_message(type=LUNCH, planId=${params.morningPlanId}, require=CONFIRM_OR_SKIP)。注意：不要调用 create_daily_plan——LUNCH 不单独建计划，只是对已有的 MORNING 计划发一条提醒消息。`;
}

export function buildEveningGoal(params: {
  dateKey: string;
  eveningPlanId: string;
  morningOutcome: "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" | "OTHER";
}): string {
  return `今天是 ${params.dateKey}，晚上 20:30 的触发，今日复盘 + 请求体重打卡。今天早上计划的最终结果是：${params.morningOutcome}（COMPLETED=完成，SKIPPED=跳过，AUTO_ACCEPTED=未回复已按计划自动执行，OTHER=当天没有计划）。

请依次：
1. 调用 get_engagement_trend 和 get_recent_episodes（近几天的模式，比如是否连续跳过）；
2. 结合当天结果、参与度趋势、用户的动机 hook（如果是 event 类型要提一下倒计时），用一段文字说明今晚复盘该怎么说、语气要不要调整；
3. 调用 send_proactive_message(type=EVENING, planId=${params.eveningPlanId}, require=CHECKIN)，文案里包含复盘 + 请求记录体重。注意：不要调用 create_daily_plan——EVENING 计划已经建好了（planId 已给出），你只需要发消息。`;
}

export function buildSwapGoal(params: {
  dateKey: string;
  planId: string;
  oldMealKey: string;
  oldMealTitle: string;
}): string {
  return `用户点击了「换一个」，要把当前 planId=${params.planId} 的午饭从「${params.oldMealTitle}」（key=${params.oldMealKey}）换成另一道菜。今天是 ${params.dateKey}。

请依次：
1. 调用 list_candidate_meals(excludeMealKeys=["${params.oldMealKey}"]) 拿到候选；
2. 用一段文字说明你为什么选这道新菜（可以参考候选的 kcal/tags，不需要额外查 profile）；
3. 调用 update_daily_plan(planId="${params.planId}", mealKey=新选的 key, status="SWAPPED")；
4. 调用 record_preference_signal(mealKey="${params.oldMealKey}", signal="dislike") 记录一次对旧菜的负反馈。
不要调用 send_proactive_message 或 ask_user——这次不发新消息，用户看到的是计划本身更新了。`;
}
