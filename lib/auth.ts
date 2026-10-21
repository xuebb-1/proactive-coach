import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, validSession } from "./auth-session";

export async function hasOwnerSession() {
  return validSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireOwnerSession() {
  if (!(await hasOwnerSession())) redirect("/login");
}
