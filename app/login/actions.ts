"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, createSession, SESSION_COOKIE, SESSION_SECONDS, validPassword } from "@/lib/auth-session";

export async function loginAction(_state: string | null, data: FormData): Promise<string | null> {
  if (!authConfigured()) return "暂时无法登录，请联系站点所有者完成访问配置。";
  const password = String(data.get("password") ?? "");
  if (password.length > 256 || !validPassword(password)) {
    // A strong owner password is required; also throttle each invalid request.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return "密码不正确，请重试。";
  }
  (await cookies()).set(SESSION_COOKIE, createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/", maxAge: SESSION_SECONDS,
  });
  redirect("/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
