import { respondToMessageAction, respondToAskUserAction, submitCheckinAction } from "@/app/actions";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待处理",
  CONFIRMED: "已确认",
  SWAPPED: "已换菜",
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
  AUTO_ACCEPTED: "未回复 · 已按计划执行",
  EXPIRED: "已过期",
};

type MessageForCard = {
  id: string;
  text: string;
  require: string;
  payload: string;
  respondedAt: Date | null;
  responseAction: string | null;
};

type PlanForCard = {
  status: string;
} | null;

export function MessageCard({
  message,
  plan,
  todaysWeightKg,
}: {
  message: MessageForCard;
  plan: PlanForCard;
  todaysWeightKg?: number | null;
}) {
  const answered = message.respondedAt !== null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[15px] leading-relaxed text-neutral-800">{message.text}</p>

      {plan && (
        <p className="mt-2 text-xs text-neutral-400">状态：{STATUS_LABEL[plan.status] ?? plan.status}</p>
      )}

      {!answered && message.require === "CONFIRM_OR_SWAP" && (
        <div className="mt-3 flex gap-2">
          <form action={respondToMessageAction}>
            <input type="hidden" name="messageId" value={message.id} />
            <input type="hidden" name="action" value="confirm" />
            <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
              确认
            </button>
          </form>
          <form action={respondToMessageAction}>
            <input type="hidden" name="messageId" value={message.id} />
            <input type="hidden" name="action" value="swap" />
            <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              换一个
            </button>
          </form>
        </div>
      )}

      {!answered && message.require === "CONFIRM_OR_SKIP" && (
        <div className="mt-3 flex gap-2">
          <form action={respondToMessageAction}>
            <input type="hidden" name="messageId" value={message.id} />
            <input type="hidden" name="action" value="complete" />
            <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
              完成
            </button>
          </form>
          <form action={respondToMessageAction}>
            <input type="hidden" name="messageId" value={message.id} />
            <input type="hidden" name="action" value="skip" />
            <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              跳过
            </button>
          </form>
        </div>
      )}

      {!answered && message.require === "ASK_USER" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(() => {
            let options: Array<{ label: string; value: string }> = [];
            try {
              options = JSON.parse(message.payload || "{}").options ?? [];
            } catch {
              options = [];
            }
            return options.map((opt) => (
              <form action={respondToAskUserAction} key={opt.value}>
                <input type="hidden" name="messageId" value={message.id} />
                <input type="hidden" name="optionValue" value={opt.value} />
                <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
                  {opt.label}
                </button>
              </form>
            ));
          })()}
        </div>
      )}
      {answered && message.require === "ASK_USER" && (
        <p className="mt-3 text-sm text-neutral-500">已选择：{message.responseAction}</p>
      )}

      {message.require === "CHECKIN" &&
        (answered || todaysWeightKg != null ? (
          <p className="mt-3 text-sm text-neutral-500">
            {todaysWeightKg != null ? `今日体重已记录：${todaysWeightKg}kg` : "已记录"}
          </p>
        ) : (
          <form action={submitCheckinAction} className="mt-3 flex items-center gap-2">
            <input
              name="weightKg"
              type="number"
              step="0.1"
              required
              placeholder="今日体重 kg"
              className="w-32 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
              记录
            </button>
          </form>
        ))}
    </div>
  );
}
