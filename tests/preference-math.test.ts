import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  recordSwap,
  recordCompletion,
  confirmDislike,
  revertSwapSignal,
} from "@/lib/memory/preference";

/**
 * 置信度数学的集成测试（跑在本地 dev.db 上，用独立的临时用户，测完清理）。
 * 这些规则是"置信度由代码控制、不接受模型浮点数"这一卖点的可验证载体：
 * swap +0.2 / complete +0.15 / 首次 0.3+boost / 对立键互衰减 / 归因修正。
 */

let userId: string;

async function conf(key: string): Promise<number | undefined> {
  const row = await prisma.preferenceMemory.findUnique({ where: { userId_key: { userId, key } } });
  return row?.confidence;
}
async function sourceOf(key: string): Promise<string | undefined> {
  const row = await prisma.preferenceMemory.findUnique({ where: { userId_key: { userId, key } } });
  return row?.source;
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: {} });
  userId = user.id;
});

afterAll(async () => {
  await prisma.preferenceMemory.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("preference confidence math", () => {
  it("first swap creates dislike at 0.3 + 0.2 = 0.5", async () => {
    await recordSwap(userId, "meal_a");
    expect(await conf("dislike:meal_a")).toBeCloseTo(0.5);
  });

  it("completion boosts prefer AND attenuates the opposite dislike key", async () => {
    // dislike:meal_a is at 0.5 from the previous test.
    await recordCompletion(userId, "meal_a");
    expect(await conf("prefer:meal_a")).toBeCloseTo(0.45); // 0.3 + 0.15
    expect(await conf("dislike:meal_a")).toBeCloseTo(0.35); // 0.5 - 0.15
  });

  it("swap attenuates the opposite prefer key symmetrically", async () => {
    await recordSwap(userId, "meal_a");
    expect(await conf("dislike:meal_a")).toBeCloseTo(0.55); // 0.35 + 0.2
    expect(await conf("prefer:meal_a")).toBeCloseTo(0.25); // 0.45 - 0.2
  });

  it("attenuation floors at 0, never negative", async () => {
    await recordSwap(userId, "meal_a");
    await recordSwap(userId, "meal_a");
    expect(await conf("prefer:meal_a")).toBe(0);
  });

  it("revertSwapSignal undoes exactly one swap boost (misattributed swap)", async () => {
    await recordSwap(userId, "meal_b"); // -> 0.5
    await revertSwapSignal(userId, "meal_b"); // -> 0.3
    expect(await conf("dislike:meal_b")).toBeCloseTo(0.3);
  });

  it("confirmDislike lifts above threshold and marks user_confirmed", async () => {
    // dislike:meal_b is at 0.3 (below the 0.5 filter threshold).
    await confirmDislike(userId, "meal_b");
    expect(await conf("dislike:meal_b")).toBeCloseTo(0.7); // max(0.3, 0.5 + 0.2)
    expect(await sourceOf("dislike:meal_b")).toBe("user_confirmed");
  });
});
