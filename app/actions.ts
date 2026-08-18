"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/user";
import { respondToMessage, respondToAskUser, submitCheckin, type ButtonAction } from "@/lib/orchestrator/actions";

export async function respondToMessageAction(formData: FormData) {
  const user = await requireCurrentUser();
  const messageId = String(formData.get("messageId"));
  const action = String(formData.get("action")) as ButtonAction;
  await respondToMessage(user.id, messageId, action);
  revalidatePath("/");
}

export async function respondToAskUserAction(formData: FormData) {
  const user = await requireCurrentUser();
  const messageId = String(formData.get("messageId"));
  const optionValue = String(formData.get("optionValue"));
  await respondToAskUser(user.id, messageId, optionValue);
  revalidatePath("/");
}

export async function submitCheckinAction(formData: FormData) {
  const user = await requireCurrentUser();
  const weightKg = Number(formData.get("weightKg"));
  const difficultyRaw = formData.get("difficulty");
  const difficulty = difficultyRaw ? Number(difficultyRaw) : undefined;
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error("请输入有效体重");
  }
  await submitCheckin(user.id, weightKg, difficulty);
  revalidatePath("/");
}

export async function createOnboardingAction(formData: FormData) {
  const existing = await prisma.user.findFirst();
  if (existing) {
    redirect("/");
  }

  const goalWeightKg = Number(formData.get("goalWeightKg"));
  const currentWeightKg = Number(formData.get("currentWeightKg"));
  const dislikedFoodsRaw = String(formData.get("dislikedFoods") || "");
  const eatingModeRaw = String(formData.get("eatingMode") || "canteen");
  const eatingMode = ["cook", "canteen", "takeout"].includes(eatingModeRaw) ? eatingModeRaw : "canteen";
  const morningTime = String(formData.get("morningTime") || "07:30");
  const lunchTime = String(formData.get("lunchTime") || "12:00");
  const eveningTime = String(formData.get("eveningTime") || "20:30");
  const tonePreference = String(formData.get("tonePreference") || "gentle");
  const motivationHook = String(formData.get("motivationHook") || "health");
  const eventLabel = String(formData.get("eventLabel") || "").trim();
  const eventDateRaw = String(formData.get("eventDate") || "").trim();

  const dislikedFoods = dislikedFoodsRaw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const user = await prisma.user.create({
    data: {
      profile: {
        create: {
          goalWeightKg,
          currentWeightKg,
          dislikedFoods: JSON.stringify(dislikedFoods),
          eatingMode,
          morningTime,
          lunchTime,
          eveningTime,
        },
      },
      persona: {
        create: {
          tonePreference,
          motivationHook,
          eventLabel: motivationHook === "event" && eventLabel ? eventLabel : null,
          eventDate: motivationHook === "event" && eventDateRaw ? new Date(eventDateRaw) : null,
        },
      },
    },
  });

  void user;
  revalidatePath("/");
  redirect("/");
}

// ---------- Meal knowledge base (/meals) ----------

const MEAL_MODES = ["cook", "canteen", "takeout"] as const;

function parseMealForm(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  const kcal = Number(formData.get("kcal"));
  const modeRaw = String(formData.get("mode") || "canteen");
  const mode = (MEAL_MODES as readonly string[]).includes(modeRaw) ? modeRaw : "canteen";
  // Tags drive the dislike filter (substring match) -- empty tags mean the
  // dislike guardrail can only match against the title.
  const tags = String(formData.get("tags") || "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!title) throw new Error("菜名不能为空");
  if (!Number.isFinite(kcal) || kcal <= 0 || kcal > 3000) throw new Error("热量应为 1-3000 kcal");
  return { title, kcal: Math.round(kcal), mode, tags };
}

export async function createMealAction(formData: FormData) {
  const data = parseMealForm(formData);
  const key = `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await prisma.meal.create({ data: { key, source: "user", ...data } });
  revalidatePath("/meals");
}

export async function updateMealAction(formData: FormData) {
  const id = String(formData.get("id"));
  const data = parseMealForm(formData);
  await prisma.meal.update({ where: { id }, data });
  revalidatePath("/meals");
}

export async function toggleMealAction(formData: FormData) {
  const id = String(formData.get("id"));
  const meal = await prisma.meal.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
  await prisma.meal.update({ where: { id }, data: { isActive: !meal.isActive } });
  revalidatePath("/meals");
}
