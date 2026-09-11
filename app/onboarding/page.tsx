import { createOnboardingAction } from "@/app/actions";
import { getCurrentUser } from "@/lib/user";
import { redirect } from "next/navigation";

// Must check the DB per-request (not at build time) to decide whether to
// redirect an already-onboarded user back to the today page.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const existing = await getCurrentUser();
  if (existing?.profile && existing.persona) redirect("/");

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-xl font-semibold text-neutral-900">开始之前，先了解你一下</h1>
      <p className="mt-2 text-sm text-neutral-500">
        只需要填一次。之后它会按这些信息主动找你，不用你每次打开对话。
      </p>

      <form action={createOnboardingAction} className="mt-8 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-neutral-700">目标</h2>
          <label className="flex flex-col gap-1 text-sm">
            当前体重 (kg)
            <input
              name="currentWeightKg"
              type="number"
              step="0.1"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            目标体重 (kg)
            <input
              name="goalWeightKg"
              type="number"
              step="0.1"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <span>平时怎么解决吃饭</span>
            <label className="flex items-center gap-2">
              <input type="radio" name="eatingMode" value="canteen" defaultChecked /> 公司食堂为主（偶尔外卖）
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="eatingMode" value="takeout" /> 外卖为主
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="eatingMode" value="cook" /> 自己做饭
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            忌口 / 不吃的东西（逗号分隔，可留空）
            <input
              name="dislikedFoods"
              type="text"
              placeholder="香菜, 内脏"
              className="rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-neutral-700">提醒时间</h2>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              早上
              <input name="morningTime" type="time" defaultValue="07:30" className="rounded-lg border border-neutral-300 px-2 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              中午
              <input name="lunchTime" type="time" defaultValue="12:00" className="rounded-lg border border-neutral-300 px-2 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              晚上
              <input name="eveningTime" type="time" defaultValue="20:30" className="rounded-lg border border-neutral-300 px-2 py-2" />
            </label>
          </div>
          <p className="text-xs text-neutral-400">
            系统会按你的时区和这些时间主动提醒。
          </p>
          <label className="flex flex-col gap-1 text-sm">
            时区
            <select name="timezone" defaultValue="Asia/Shanghai" className="rounded-lg border border-neutral-300 px-3 py-2">
              <option value="Asia/Shanghai">中国标准时间</option>
              <option value="Asia/Tokyo">日本标准时间</option>
              <option value="Europe/London">伦敦时间</option>
              <option value="America/Los_Angeles">美国太平洋时间</option>
              <option value="America/New_York">美国东部时间</option>
            </select>
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-neutral-700">你更喜欢被怎么提醒</h2>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="tonePreference" value="gentle" defaultChecked /> 温和鼓励
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="tonePreference" value="firm" /> 直接督促
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="tonePreference" value="analytical" /> 数据理性
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-neutral-700">你主要为了什么坚持</h2>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="motivationHook" value="health" defaultChecked /> 健康
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="motivationHook" value="appearance" /> 外形体型
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="motivationHook" value="event" /> 特定事件（如婚礼、体检）
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="motivationHook" value="discipline" /> 想给自己一个交代
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="eventLabel"
              type="text"
              placeholder="事件名称（选了「特定事件」再填）"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <input
              name="eventDate"
              type="date"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </section>

        <button
          type="submit"
          className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          开始
        </button>
      </form>
    </main>
  );
}
