"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const TRIGGERS = [
  { type: "morning", label: "触发早上" },
  { type: "lunch", label: "触发中午" },
  { type: "evening", label: "触发晚上" },
] as const;

/**
 * Local-dev-only helper: Vercel Cron doesn't run on `next dev`, so this lets
 * you manually fire each daily trigger to test the full loop end to end.
 * Safe to ship -- it just calls the same cron endpoint Vercel would call.
 */
export function DevTriggerPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function trigger(type: string) {
    const res = await fetch(`/api/cron/${type}`);
    const data = await res.json();
    setLastResult(`${type}: ${JSON.stringify(data.result ?? data.error)}`);
    startTransition(() => router.refresh());
  }

  return (
    <details className="mt-10 rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
      <summary className="cursor-pointer select-none">开发者工具（本地测试用，模拟 Vercel Cron）</summary>
      <div className="mt-3 flex gap-2">
        {TRIGGERS.map((t) => (
          <button
            key={t.type}
            onClick={() => trigger(t.type)}
            disabled={pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-50"
          >
            {t.label}
          </button>
        ))}
      </div>
      {lastResult && <p className="mt-2 break-all text-xs text-neutral-400">{lastResult}</p>}
    </details>
  );
}
