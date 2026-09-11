import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCandidateMeals } from "@/lib/scenarios/weightloss/planner";
import { createTestUser, deleteTestUser } from "./helpers/db";

let userA: Awaited<ReturnType<typeof createTestUser>>;
let userB: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  userA = await createTestUser();
  userB = await createTestUser();
  await prisma.meal.createMany({
    data: [
      { key: `private_${userA.id}`, title: "A 私有菜", kcal: 500, tags: [], mode: "canteen", source: "user", ownerId: userA.id },
      { key: `private_${userB.id}`, title: "B 私有菜", kcal: 500, tags: [], mode: "canteen", source: "user", ownerId: userB.id },
    ],
  });
});

afterAll(async () => {
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("candidate meals include platform seed and own private meals only", async () => {
    const candidates = await getCandidateMeals(userA.id, []);
    const keys = candidates.map((meal) => meal.key);
    expect(keys).toContain(`private_${userA.id}`);
    expect(keys).not.toContain(`private_${userB.id}`);
  });
});
