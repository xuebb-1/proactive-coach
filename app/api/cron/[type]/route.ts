import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/user";
import { runMorning, runLunch, runEvening } from "@/lib/orchestrator/daily-orchestrator";

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

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured (local dev) -- allow through so `curl` testing works
  // without extra setup. Vercel Cron always sends this header when a secret
  // is configured, per https://vercel.com/docs/cron-jobs/manage-cron-jobs.
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { type } = await ctx.params;
  const handler = HANDLERS[type as keyof typeof HANDLERS];
  if (!handler) {
    return NextResponse.json({ error: `unknown trigger type: ${type}` }, { status: 400 });
  }

  try {
    const user = await requireCurrentUser();
    const result = await handler(user);
    return NextResponse.json({ ok: true, type, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, type, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
