import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { parseTraceSteps, type TraceStep } from "@/lib/agent/trace";
import { getWeeklySwapTrend, getRepeatMistakeStats, getInferencePrecision } from "@/lib/memory/metrics";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  REAL: "real · DeepSeek",
  MOCK: "mock · 离线开发",
  DETERMINISTIC: "deterministic · 无模型",
};

const SOURCE_STYLE: Record<string, string> = {
  REAL: "bg-emerald-100 text-emerald-700",
  MOCK: "bg-amber-100 text-amber-700",
  DETERMINISTIC: "bg-neutral-100 text-neutral-500",
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETE: "完成",
  INCOMPLETE: "未收敛 · 已降级",
  FAILED: "失败",
};

const TRIGGER_LABEL: Record<string, string> = {
  morning: "早上",
  lunch: "中午",
  evening: "晚上",
  swap: "换一个",
  confirm: "确认",
  complete: "完成",
  skip: "跳过",
};

function StepView({ step, idx }: { step: TraceStep; idx: number }) {
  if (step.type === "model_text") {
    return (
      <li key={idx} className="rounded-md bg-neutral-50 p-2 text-neutral-700">
        <span className="mr-1.5 text-xs font-medium text-neutral-400">推理</span>
        {step.text}
      </li>
    );
  }
  if (step.type === "tool_call") {
    return (
      <li key={idx} className="rounded-md bg-blue-50 p-2 font-mono text-xs text-blue-800">
        <span className="mr-1.5 rounded bg-blue-100 px-1.5 py-0.5 font-sans font-medium">调用</span>
        {step.toolName}({JSON.stringify(step.input)})
      </li>
    );
  }
  if (step.type === "tool_result") {
    return (
      <li key={idx} className="rounded-md bg-neutral-50 p-2 font-mono text-xs text-neutral-600">
        <span className="mr-1.5 rounded bg-neutral-200 px-1.5 py-0.5 font-sans font-medium">返回</span>
        {step.toolName} → {JSON.stringify(step.output)}
      </li>
    );
  }
  if (step.type === "final_message") {
    return (
      <li key={idx} className="rounded-md bg-neutral-900 p-2 text-white">
        <span className="mr-1.5 text-xs font-medium text-neutral-400">最终消息</span>
        {step.text}
      </li>
    );
  }
  return (
    <li key={idx} className="rounded-md bg-red-50 p-2 text-red-700">
      <span className="mr-1.5 text-xs font-medium text-red-400">错误</span>
      {step.message}
    </li>
  );
}

export default async function TracePage() {
  const user = await getCurrentUser();
  if (!user || !user.profile || !user.persona) {
    redirect("/onboarding");
  }

  const [traces, swapTrend, repeatStats, precision] = await Promise.all([
    prisma.agentTrace.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    getWeeklySwapTrend(user.id),
    getRepeatMistakeStats(user.id),
    getInferencePrecision(user.id),
  ]);

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-400">Agent Trace</p>
          <h1 className="mt-1 text-lg font-semibold text-neutral-900">每一轮 Agent 都在这里可查</h1>
        </div>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← 今天
        </Link>
      </header>

      <section className="mb-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          记忆有效性 · 记的东西有没有让决策变好
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-xs text-neutral-400">换菜率（周）</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {pct(swapTrend[swapTrend.length - 1]?.rate ?? null)}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-neutral-400">
              {swapTrend.map((p) => `${p.label} ${pct(p.rate)}`).join(" · ")}
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">偏好学习有效则应逐周下降</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-xs text-neutral-400">重复踩坑率</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">{pct(repeatStats.rate)}</p>
            <p className="mt-1 text-[11px] leading-4 text-neutral-400">
              已拒绝过的菜/类目再推 {repeatStats.repeatRecommended} 次，其中又被换 {repeatStats.repeatSwapped} 次
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">高 = 记了但决策没用上</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-xs text-neutral-400">推断准确率</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">{pct(precision.precision)}</p>
            <p className="mt-1 text-[11px] leading-4 text-neutral-400">
              归因询问 {precision.asked} 次，确认不爱吃 {precision.confirmed} 次
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">低 = swap→dislike 归因在产生噪音</p>
          </div>
        </div>
      </section>

      {traces.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          还没有 Trace。触发一次早上/中午/晚上，或者点一次「换一个」。
        </div>
      )}

      <div className="flex flex-col gap-3">
        {traces.map((t) => {
          const steps = parseTraceSteps(t.steps);
          return (
            <details key={t.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-800">
                  {TRIGGER_LABEL[t.trigger] ?? t.trigger}
                  <span className="ml-2 text-xs text-neutral-400">{t.createdAt.toLocaleString("zh-CN")}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${SOURCE_STYLE[t.source] ?? ""}`}>
                    {SOURCE_LABEL[t.source] ?? t.source}
                  </span>
                  <span className="text-xs text-neutral-400">{STATUS_LABEL[t.status] ?? t.status}</span>
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-xs text-neutral-400">{t.goal}</p>
              <ol className="mt-3 flex flex-col gap-1.5 text-sm">
                {steps.map((step, idx) => (
                  <StepView key={idx} step={step} idx={idx} />
                ))}
              </ol>
            </details>
          );
        })}
      </div>
    </main>
  );
}
