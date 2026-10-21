"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <label htmlFor="password" className="text-sm text-neutral-600">访问密码</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256}
        className="rounded-md border border-neutral-300 px-3 py-2" />
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "正在登录…" : "登录"}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}
