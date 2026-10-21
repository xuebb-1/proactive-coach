import { redirect } from "next/navigation";
import { hasOwnerSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasOwnerSession()) redirect("/");
  return (
    <main className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-xl font-semibold">个人教练</h1>
      <p className="mt-2 text-sm text-neutral-500">登录后查看你的计划与记录。</p>
      <LoginForm />
    </main>
  );
}
