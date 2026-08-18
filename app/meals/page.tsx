import Link from "next/link";
import { prisma } from "@/lib/db";
import { createMealAction, updateMealAction, toggleMealAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const MODE_LABELS: Record<string, string> = {
  cook: "自己做饭",
  canteen: "食堂",
  takeout: "外卖",
};

function MealForm({
  action,
  meal,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  meal?: { id: string; title: string; kcal: number; tags: string[]; mode: string };
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 text-sm">
      {meal && <input type="hidden" name="id" value={meal.id} />}
      <input
        name="title"
        defaultValue={meal?.title}
        required
        placeholder="菜名 / 组餐策略，如：食堂：番茄牛腩 + 两素 + 半饭"
        className="rounded-md border border-neutral-300 px-3 py-2"
      />
      <div className="flex gap-2">
        <input
          name="kcal"
          type="number"
          defaultValue={meal?.kcal}
          required
          min={1}
          max={3000}
          placeholder="热量估计 (kcal)"
          className="w-40 rounded-md border border-neutral-300 px-3 py-2"
        />
        <select name="mode" defaultValue={meal?.mode ?? "canteen"} className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="canteen">食堂</option>
          <option value="takeout">外卖</option>
          <option value="cook">自己做饭</option>
        </select>
      </div>
      <input
        name="tags"
        defaultValue={meal?.tags.join("，")}
        placeholder="食材标签，逗号分隔，如：牛肉，番茄，米饭"
        className="rounded-md border border-neutral-300 px-3 py-2"
      />
      <p className="text-xs text-neutral-400">
        标签用于忌口过滤：忌口词命中任一标签时该菜会被排除。含蘑菇就写「蘑菇」，缺标签则忌口拦不住它。
      </p>
      <button
        type="submit"
        className="self-start rounded-md border border-neutral-800 bg-neutral-900 px-4 py-1.5 text-white hover:bg-neutral-700"
      >
        {submitLabel}
      </button>
    </form>
  );
}

export default async function MealsPage() {
  const meals = await prisma.meal.findMany({
    orderBy: [{ mode: "asc" }, { isActive: "desc" }, { createdAt: "asc" }],
  });
  const byMode = new Map<string, typeof meals>();
  for (const m of meals) {
    if (!byMode.has(m.mode)) byMode.set(m.mode, []);
    byMode.get(m.mode)!.push(m);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">菜品库</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Agent 只会从这里的启用条目中挑选推荐。停用而非删除：历史计划还要靠它回查名称。
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline">
          ← 今天
        </Link>
      </header>

      <details className="mb-8 rounded-xl border border-neutral-300 p-4" open={meals.length === 0}>
        <summary className="cursor-pointer select-none text-sm font-medium text-neutral-900">+ 录入新菜品</summary>
        <MealForm action={createMealAction} submitLabel="添加" />
      </details>

      {["canteen", "takeout", "cook"].map((mode) => {
        const list = byMode.get(mode) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={mode} className="mb-8">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
              {MODE_LABELS[mode] ?? mode} · {list.filter((m) => m.isActive).length} 启用 / {list.length} 条
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((meal) => (
                <li
                  key={meal.id}
                  className={`rounded-xl border p-3 ${meal.isActive ? "border-neutral-200" : "border-dashed border-neutral-300 opacity-60"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-neutral-900">{meal.title}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {meal.kcal} kcal · {meal.tags.length > 0 ? meal.tags.join(" / ") : "无标签"}
                        {meal.source === "user" && " · 自己录的"}
                        {!meal.isActive && " · 已停用"}
                      </p>
                    </div>
                    <form action={toggleMealAction} className="shrink-0">
                      <input type="hidden" name="id" value={meal.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                      >
                        {meal.isActive ? "停用" : "启用"}
                      </button>
                    </form>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer select-none text-xs text-neutral-400 hover:text-neutral-600">编辑</summary>
                    <MealForm action={updateMealAction} meal={meal} submitLabel="保存" />
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
