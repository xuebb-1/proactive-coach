import type { EngagementTrend } from "./engagement";

export type Tone = "gentle" | "firm" | "analytical";
export type Hook = "health" | "appearance" | "event" | "discipline";

export type HookContext = {
  eventLabel?: string | null;
  daysLeft?: number | null;
  completionRatePct?: number | null;
};

function variant(arr: string[], seed: number): string {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}

/** Day-of-year based seed so phrasing rotates day to day without randomness. */
function daySeed(dateKey: string): number {
  return dateKey.split("-").reduce((acc, part) => acc + Number(part), 0);
}

// Engagement trend can override the stated tone preference: a dropping
// completion rate should soften pressure regardless of the user's usual
// preference (this mirrors Noom's approach of easing off when users
// disengage, rather than pushing harder).
function effectiveTone(tone: Tone, trend: EngagementTrend): Tone {
  if (trend === "down" && tone === "firm") return "gentle";
  return tone;
}

const MORNING_OPENERS: Record<Tone, string[]> = {
  gentle: ["早呀，新的一天开始啦。", "早上好，一起把今天安排一下。"],
  firm: ["起来了，今天的安排。", "开始，今天该做的事。"],
  analytical: ["今日计划已生成。", "每日计划：以下是今天的建议。"],
};

const LUNCH_REMINDER_OPENERS: Record<Tone, string[]> = {
  gentle: ["中午到啦，", "饭点到了，"],
  firm: ["12 点了，", "该吃饭了，"],
  analytical: ["午间检查点：", "12:00 状态检查。"],
};

const EVENING_OPENERS: Record<
  "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" | "OTHER",
  Record<Tone, string[]>
> = {
  COMPLETED: {
    gentle: ["今天完成得不错，", "干得漂亮，"],
    firm: ["完成了，继续保持。", "达标，明天同样标准。"],
    analytical: ["今日计划已完成。", "完成率：本次达标。"],
  },
  SKIPPED: {
    gentle: ["今天跳过了也没关系，", "偶尔一次不影响大局，"],
    firm: ["今天跳过了，明天补回来。", "跳过记一笔，别连续两天。"],
    analytical: ["今日计划：跳过。", "状态：未执行。"],
  },
  AUTO_ACCEPTED: {
    gentle: ["今天没来得及回复我，按计划先执行了，", "没等到回复，先按原计划走了，"],
    firm: ["没确认，按计划自动执行了。", "默认执行，下次记得点一下。"],
    analytical: ["未响应，系统按默认策略执行。", "自动状态：已按原计划标记完成。"],
  },
  OTHER: {
    gentle: ["晚上好，", "一天快过去啦，"],
    firm: ["复盘时间。", "晚间检查点。"],
    analytical: ["晚间复盘：", "Daily review："],
  },
};

const MORNING_CLOSINGS: Record<Tone, string[]> = {
  gentle: ["要不要试试这个？", "还满意吗，可以换一个哦。"],
  firm: ["确认还是换？", "定了没？"],
  analytical: ["选择：确认 / 更换。", "请选择：确认或更换建议。"],
};

const LUNCH_CLOSINGS: Record<Tone, string[]> = {
  gentle: ["吃了跟我说一声，或者跳过也行。", "完成了点一下，跳过也可以。"],
  firm: ["完成还是跳过，选一个。", "点一下：完成 / 跳过。"],
  analytical: ["请更新状态：完成 / 跳过。", "状态更新：完成或跳过。"],
};

const CHECKIN_CLOSINGS: Record<Tone, string[]> = {
  gentle: ["体重方便的话记一下～", "有空称一下体重呗。"],
  firm: ["体重记一下。", "称重，现在就做。"],
  analytical: ["请记录今日体重以更新趋势。", "体重数据点：待补充。"],
};

function hookLine(hook: Hook, ctx: HookContext): string {
  switch (hook) {
    case "health":
      return "这份安排对代谢和状态比较友好。";
    case "appearance":
      return "坚持下去，线条会更明显。";
    case "event": {
      const label = ctx.eventLabel || "你在意的那件事";
      const days = ctx.daysLeft != null ? `还有 ${ctx.daysLeft} 天` : "不远了";
      return `距离${label}${days}，今天先稳住。`;
    }
    case "discipline":
      return "不需要理由，按计划执行就好。";
  }
}

export function buildMorningMessage(params: {
  tone: Tone;
  hook: Hook;
  hookContext: HookContext;
  trend: EngagementTrend;
  dateKey: string;
  mealTitle: string;
  kcal: number;
}): string {
  const tone = effectiveTone(params.tone, params.trend);
  const seed = daySeed(params.dateKey);
  const opener = variant(MORNING_OPENERS[tone], seed);
  const mealLine = `午饭建议：${params.mealTitle}（约 ${params.kcal} kcal）。`;
  const hook = hookLine(params.hook, params.hookContext);
  const closing = variant(MORNING_CLOSINGS[tone], seed + 1);
  return `${opener}${mealLine}${hook}${closing}`;
}

export function buildLunchReminderMessage(params: {
  tone: Tone;
  trend: EngagementTrend;
  dateKey: string;
  mealTitle: string;
  alreadyDecided: boolean;
}): string {
  const tone = effectiveTone(params.tone, params.trend);
  const seed = daySeed(params.dateKey);
  const opener = variant(LUNCH_REMINDER_OPENERS[tone], seed);
  const mealLine = params.alreadyDecided
    ? `按计划：${params.mealTitle}。`
    : `早上建议的「${params.mealTitle}」你还没回复。`;
  const closing = variant(LUNCH_CLOSINGS[tone], seed + 1);
  return `${opener}${mealLine}${closing}`;
}

export function buildEveningMessage(params: {
  tone: Tone;
  hook: Hook;
  hookContext: HookContext;
  trend: EngagementTrend;
  dateKey: string;
  morningOutcome: "COMPLETED" | "SKIPPED" | "AUTO_ACCEPTED" | "OTHER";
}): string {
  const tone = effectiveTone(params.tone, params.trend);
  const seed = daySeed(params.dateKey);
  const openerPool = EVENING_OPENERS[params.morningOutcome][tone];
  const opener = variant(openerPool, seed);
  const hook = hookLine(params.hook, params.hookContext);
  const closing = variant(CHECKIN_CLOSINGS[tone], seed + 1);
  return `${opener}${hook}${closing}`;
}
