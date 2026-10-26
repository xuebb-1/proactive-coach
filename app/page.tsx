import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { todayKeyForTimeZone } from "@/lib/date";
import { MessageCard } from "@/app/components/MessageCard";
import { DevTriggerPanel } from "@/app/components/DevTriggerPanel";

// Must be evaluated per-request, not baked in at build time -- this page
// reflects live DB state (today's messages, plan status) that changes
// throughout the day as cron triggers and button actions fire.
export const dynamic = "force-dynamic";
// The swap button's Server Action runs an Agent turn (15-80s measured);
// Server Actions inherit the invoking page's maxDuration.
export const maxDuration = 300;

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user || !user.profile || !user.persona) {
    redirect("/onboarding");
  }

  const dateKey = todayKeyForTimeZone(user.profile.timezone);

  const [morningPlan, eveningPlan] = await Promise.all([prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "MORNING" } },
  }), prisma.dailyPlan.findUnique({
    where: { userId_date_type: { userId: user.id, date: dateKey, type: "EVENING" } },
  })]);

  // Questions render separately; every normal daily slot has a unique deliveryKey.
  const slotMessage = (slot: "MORNING" | "LUNCH" | "EVENING") => prisma.message.findFirst({
    where: { userId: user.id, deliveryKey: `${user.id}:${dateKey}:${slot}`, require: { not: "ASK_USER" } },
  });
  const [morningMessage, lunchMessage, eveningMessage, askUserMessages] = await Promise.all([
    slotMessage("MORNING"), slotMessage("LUNCH"), slotMessage("EVENING"),
    // ask_user messages may have no plan attached at all -- fetch them by
    // require, not via the plan, or they'd never surface.
    prisma.message.findMany({
      where: { userId: user.id, require: "ASK_USER", respondedAt: null, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const todaysCheckin = await prisma.checkIn.findFirst({ where: { userId: user.id, date: dateKey } });

  const recentCheckins = await prisma.checkIn.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 7,
  });

  const recentDays = await prisma.dailyPlan.findMany({
    where: { userId: user.id, type: "MORNING" },
    orderBy: { date: "desc" },
    take: 7,
  });

  const latestWeight = todaysCheckin?.weightKg ?? recentCheckins[0]?.weightKg ?? user.profile.currentWeightKg;

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-400">{dateKey}</p>
          <h1 className="mt-1 text-lg font-semibold text-neutral-900">今天</h1>
          <p className="mt-1 text-sm text-neutral-500">
            目标 {user.profile.goalWeightKg}kg · 当前 {latestWeight}kg
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Link href="/meals" className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline">
            菜品库
          </Link>
          <Link href="/trace" className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline">
            Trace →
          </Link>
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && <UserButton />}
        </div>
      </header>

      <div className="flex flex-col gap-3">
        {askUserMessages.map((m) => (
          <MessageCard key={m.id} message={m} plan={null} />
        ))}
        {morningMessage && (
          <MessageCard message={morningMessage} plan={morningPlan} />
        )}
        {lunchMessage && (
          <MessageCard message={lunchMessage} plan={morningPlan} />
        )}
        {eveningMessage && (
          <MessageCard
            message={eveningMessage}
            plan={eveningPlan}
            todaysWeightKg={todaysCheckin?.weightKg ?? null}
          />
        )}

        {!morningMessage && !lunchMessage && !eveningMessage && askUserMessages.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            还没有新消息。它会在设定时间主动来找你。
          </div>
        )}
      </div>

      {recentCheckins.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">最近体重</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {recentCheckins.map((c) => (
              <li key={c.id} className="flex justify-between text-sm text-neutral-600">
                <span>{c.date}</span>
                <span>{c.weightKg}kg</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentDays.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">最近计划</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {recentDays.map((p) => (
              <li key={p.id} className="flex justify-between text-sm text-neutral-600">
                <span>
                  {p.date} · {p.mealTitle ?? "—"}
                </span>
                <span className="text-neutral-400">{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {process.env.NODE_ENV === "development" && <DevTriggerPanel />}
    </main>
  );
}
