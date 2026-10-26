import type { EngagementTrend } from "@/lib/orchestrator/engagement";

export const SYSTEM_PROMPT = `你是一个减肥习惯教练的规划与消息生成 Agent。你的任务是每轮读取用户的记忆和状态，做出有理由的判断，再通过工具落地——你不能直接编造菜名或者跳过工具直接"假装"发了消息。

硬性规则：
1. 菜品 mealKey 只能来自 list_candidate_meals 最近一次返回的候选，不能自己编。create_daily_plan / update_daily_plan 会在代码层拒绝不在候选里的 key。候选的形态取决于用户的吃饭方式（eatingMode）：自己做饭的是菜谱；吃食堂的是"打菜策略"（去哪个窗口、怎么搭配）；点外卖的是"下单策略"（点什么品类、怎么备注）。文案必须贴合这个场景——对吃食堂的用户不要说"做这道菜"，要说"打菜的时候……"。
2. 只有早间轮可创建 MORNING 计划；午间复用早间计划，晚间计划由调度器创建。只有换菜轮可将当前计划改为 SWAPPED；完成、跳过和未反馈状态由业务代码处理。
3. record_preference_signal 仅允许在换菜成功后，为被换掉的原餐食记录一次 dislike；完成反馈与证据去重由业务代码处理，不能推断或编造行为。
4. 每轮必须先说明你的推理依据（把参与度趋势、事件倒计时、最近签到反馈等多个信号综合起来），再调用工具；不要在没有任何文字推理的情况下直接连续调用工具。
5. 每个早午晚轮的结尾恰好一次 send_proactive_message 或 ask_user（两者选一）。没有符合忌口的候选时不要创建空计划，用 require=NONE 说明需要补充方案。换菜轮不发送新消息。

请用简体中文输出推理文字和最终消息文案。`;

export function buildMorningGoal(params: { trend: EngagementTrend; dateKey: string }): string {
  return `今天是 ${params.dateKey}。这是用户设定的早间触发。近 7 天参与度趋势：${params.trend}。

请依次：
1. 调用 get_user_profile 了解画像、语气偏好、动机 hook；
2. 调用 get_engagement_trend、search_preferences、get_recent_episodes；
3. 结合多个信号，用一段文字说明午饭安排与语气；
4. 调用 list_candidate_meals，从候选中选择；如果候选为空，不创建计划，直接发送 require=NONE 说明需要补充方案；
5. 有候选时调用 create_daily_plan(type=MORNING)；
6. 计划可操作时调用 send_proactive_message(type=MORNING, require=CONFIRM_OR_SWAP)，文案体现语气偏好和动机 hook。`;
}

export function buildLunchGoal(params: {
  dateKey: string;
  morningPlanId: string;
  morningMealTitle: string;
  morningStatus: string;
  alreadyDecided: boolean;
}): string {
  return `今天是 ${params.dateKey}，用户设定的午间触发。早上的计划（planId=${params.morningPlanId}）是「${params.morningMealTitle}」，当前状态是 ${params.morningStatus}（${
    params.alreadyDecided ? "用户已经确认或换过了" : "用户还没回复"
  }）。

请依次：
1. 调用 get_engagement_trend 了解近期参与度；
2. 用一段文字说明提醒措辞；
3. 计划状态为 PENDING、CONFIRMED 或 SWAPPED 时调用 send_proactive_message(type=LUNCH, planId=${params.morningPlanId}, require=CONFIRM_OR_SKIP)；其他状态使用 require=NONE，承认已有记录。不要调用 create_daily_plan。`;
}

export function buildEveningGoal(params: {
  dateKey: string;
  eveningPlanId: string;
  morningOutcome: "COMPLETED" | "SKIPPED" | "NO_RESPONSE" | "OTHER";
}): string {
  return `今天是 ${params.dateKey}，用户设定的晚间触发。今日早间计划结果：${params.morningOutcome}。

请依次：
1. 调用 get_engagement_trend 和 get_recent_episodes；
2. 结合当天结果、参与度趋势和动机 hook，说明复盘语气；
3. 调用 send_proactive_message(type=EVENING, planId=${params.eveningPlanId}, require=CHECKIN)，文案包含复盘与体重打卡请求。`;
}

export function buildSwapGoal(params: {
  dateKey: string;
  planId: string;
  oldMealKey: string;
  oldMealTitle: string;
}): string {
  return `用户点击了「换一个」，要把 planId=${params.planId} 从「${params.oldMealTitle}」（key=${params.oldMealKey}）换成另一道菜。今天是 ${params.dateKey}。

请依次：
1. 调用 list_candidate_meals(excludeMealKeys=["${params.oldMealKey}"])；
2. 说明选择理由；
3. 调用 update_daily_plan(planId="${params.planId}", mealKey=新 key, status="SWAPPED")；
4. 调用 record_preference_signal(mealKey="${params.oldMealKey}", signal="dislike")。
不要发送新消息。`;
}
