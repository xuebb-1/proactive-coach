"use client";

import { useActionState, type ReactNode } from "react";

export function ActionForm({ action, children, className }: {
  action: (data: FormData) => Promise<{ error?: string }>;
  children: ReactNode; className?: string;
}) {
  const [error, submit, pending] = useActionState(async (_previous: string | null, data: FormData) => {
    const result = await action(data);
    return result.error ?? null;
  }, null);
  return (
    <form action={submit} className={className}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {pending && <p role="status" className="mt-2 text-xs text-neutral-500">正在处理，请稍候…</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
