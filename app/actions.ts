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
