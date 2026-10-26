import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getOnboardedUserById } from "@/lib/user";
import { runMorning, runLunch, runEvening } from "@/lib/orchestrator/daily-orchestrator";
import { OperationBusyError } from "@/lib/operations";

export const dynamic = "force-dynamic";
// Real Agent turns take 15-80s (measured); Vercel's default function timeout
// would kill them mid-turn. 300s requires Fluid Compute (default on new
// projects) -- without it the platform clamps to the plan's max.
export const maxDuration = 300;

const HANDLERS = {
  morning: runMorning,
  lunch: runLunch,
  evening: runEvening,
} as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret && (process.env.NODE_ENV === "production" || process.env.VERCEL)) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const authorizedAdmin = Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
  // Explicit background identities always require the configured bearer secret.
  if ((secret && !authorizedAdmin) || (req.nextUrl.searchParams.has("userId") && !authorizedAdmin)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { type } = await ctx.params;
  if (!Object.hasOwn(HANDLERS, type)) {
    return NextResponse.json({ error: "unknown_trigger_type" }, { status: 400 });
  }
  const handler = HANDLERS[type as keyof typeof HANDLERS];

  try {
    const requestedUserId = req.nextUrl.searchParams.get("userId");
    const user = requestedUserId
      ? await getOnboardedUserById(requestedUserId)
      : await getCurrentUser();
    if (!user?.profile || !user.persona) {
      return NextResponse.json({ ok: false, type, error: "Onboarded user not found" }, { status: 404 });
    }
    const result = await handler({ id: user.id, profile: user.profile, persona: user.persona });
    if ("status" in result && result.status === "failed" && !result.finalMessageId) {
      return NextResponse.json({ ok: false, type, error: "agent_delivery_failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, type, result });
  } catch (err) {
    if (err instanceof OperationBusyError) {
      return NextResponse.json(
        { ok: false, type, error: "operation_in_progress" },
        { status: 409, headers: { "Retry-After": "5" } }
      );
    }
    return NextResponse.json(
      { ok: false, type, error: "agent_unavailable" },
      { status: 503 }
    );
  }
}
