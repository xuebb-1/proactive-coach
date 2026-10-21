import { NextRequest, NextResponse } from "next/server";
import { getScheduledUser } from "@/lib/user";
import { OperationBusyError } from "@/lib/operations";
import { runMorning, runLunch, runEvening } from "@/lib/orchestrator/daily-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const HANDLERS = { morning: runMorning, lunch: runLunch, evening: runEvening } as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret && (process.env.NODE_ENV === "production" || process.env.VERCEL)) {
    return NextResponse.json({ ok: false, error: "scheduler_not_configured" }, { status: 503 });
  }
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { type } = await ctx.params;
  if (!Object.hasOwn(HANDLERS, type)) return NextResponse.json({ ok: false, error: "unknown_trigger" }, { status: 400 });
  try {
    const user = await getScheduledUser();
    if (!user?.profile || !user.persona) return NextResponse.json({ ok: false, error: "onboarding_required" }, { status: 409 });
    const result = await HANDLERS[type as keyof typeof HANDLERS]({ ...user, profile: user.profile, persona: user.persona });
    const failed = "status" in result && result.status === "failed";
    return NextResponse.json({ ok: !failed, type, result }, { status: failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OperationBusyError) return NextResponse.json(
      { ok: false, error: "operation_in_progress" }, { status: 409, headers: { "Retry-After": "5" } },
    );
    console.error("Scheduled turn failed", error);
    return NextResponse.json({ ok: false, error: "scheduled_turn_failed" }, { status: 503 });
  }
}
