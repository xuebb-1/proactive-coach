import { respondToMessageAction, respondToAskUserAction, submitCheckinAction } from "@/app/actions";
import { ActionForm } from "./ActionForm";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待处理", CONFIRMED: "已确认", SWAPPED: "已换菜", COMPLETED: "已完成",
  SKIPPED: "已跳过", AUTO_ACCEPTED: "未反馈", NO_RESPONSE: "未反馈", EXPIRED: "已过期",
};
type MessageForCard = {
  id: string; text: string; require: string; payload: string; respondedAt: Date | null;
  responseAction: string | null; expiresAt: Date | null;
};
type PlanForCard = { status: string; mealKey: string | null; mealTitle: string | null; kcal: number | null } | null;

export function MessageCard({ message, plan, todaysWeightKg }: {
  message: MessageForCard; plan: PlanForCard; todaysWeightKg?: number | null;
}) {
  let payload: { swapFrom?: string; options?: Array<{ label: string; value: string }> } = {};
  try {
    const parsed: unknown = JSON.parse(message.payload || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = parsed as Record<string, unknown>;
      payload = {
        swapFrom: typeof raw.swapFrom === "string" ? raw.swapFrom : undefined,
        options: Array.isArray(raw.options) ? raw.options.filter((option): option is { label: string; value: string } => (
          !!option && typeof option === "object" && "label" in option && "value" in option &&
          typeof option.label === "string" && typeof option.value === "string"
        )) : undefined,
      };
    }
  } catch { /* Legacy empty payload. */ }
  const answered = message.respondedAt !== null;
  const expired = !message.expiresAt || message.expiresAt <= new Date();
  const ended = plan && ["COMPLETED", "SKIPPED", "NO_RESPONSE", "AUTO_ACCEPTED", "EXPIRED"].includes(plan.status);
  const canAct = !answered && !expired && !ended;
  const swapped = !!payload.swapFrom && !!plan?.mealKey && plan.mealKey !== payload.swapFrom;
  const showMeal = plan?.mealTitle && ["CONFIRM_OR_SWAP", "CONFIRM_OR_SKIP"].includes(message.require);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[15px] leading-relaxed text-neutral-800">
        {swapped ? "已更新午饭方案，中午可以记录完成情况。" : message.text}
      </p>
      {showMeal && <div className="mt-3 rounded-md bg-neutral-50 p-3">
        <p className="text-sm font-medium text-neutral-900">{plan.mealTitle}</p>
        {plan.kcal != null && <p className="mt-1 text-xs text-neutral-500">约 {plan.kcal} kcal</p>}
      </div>}
      {plan && <p className="mt-2 text-xs text-neutral-400">状态：{STATUS_LABEL[plan.status] ?? plan.status}</p>}

      {canAct && message.require === "CONFIRM_OR_SWAP" && (
        <ActionForm action={respondToMessageAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="messageId" value={message.id} />
          <button name="action" value="confirm" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">确认</button>
          <button name="action" value="swap" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">换一个</button>
        </ActionForm>
      )}
      {canAct && message.require === "CONFIRM_OR_SKIP" && (
        <ActionForm action={respondToMessageAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="messageId" value={message.id} />
          <button name="action" value="complete" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">完成</button>
          <button name="action" value="skip" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">跳过</button>
        </ActionForm>
      )}
      {!answered && !expired && message.require === "ASK_USER" && (
        <ActionForm action={respondToAskUserAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="messageId" value={message.id} />
          {payload.options?.map((option) => (
            <button key={option.value} name="optionValue" value={option.value} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">
              {option.label}
            </button>
          ))}
        </ActionForm>
      )}
      {answered && message.require === "ASK_USER" && (
        <p className="mt-3 text-sm text-neutral-500">已选择：{payload.options?.find((option) => option.value === message.responseAction)?.label ?? message.responseAction}</p>
      )}
      {message.require === "CHECKIN" && (
        answered || todaysWeightKg != null ? (
          <p className="mt-3 text-sm text-neutral-500">{todaysWeightKg != null ? `今日体重已记录：${todaysWeightKg}kg` : "已记录"}</p>
        ) : !expired ? (
          <ActionForm action={submitCheckinAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input aria-label="今日体重 kg" name="weightKg" type="number" min={1} max={500} step="0.1" required placeholder="今日体重 kg"
              className="w-32 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">记录</button>
          </ActionForm>
        ) : <p className="mt-3 text-sm text-neutral-500">这条打卡邀请已过期。</p>
      )}
    </div>
  );
}
