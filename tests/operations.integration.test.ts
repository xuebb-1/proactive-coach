import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { OperationBusyError, withUserOperation, writeTransaction } from "@/lib/operations";
import { createTestUser, deleteTestUser } from "./helpers/db";

const userIds: string[] = [];
async function fixture() {
  const user = await createTestUser({ seedMeals: false });
  userIds.push(user.id);
  return user;
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(async () => {
  for (const id of userIds.splice(0)) await deleteTestUser(id);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("per-user database operation leases", () => {
  it("rejects an overlapping user while a different user finishes independently", async () => {
    const [a, b] = await Promise.all([fixture(), fixture()]);
    const ready = signal();
    const release = signal();
    let aReleased = false;
    let duplicateEntered = false;
    const first = withUserOperation(a.id, `${a.id}:first`, async () => {
      ready.resolve();
      await release.promise;
    });
    try {
      await ready.promise;
      await expect(withUserOperation(a.id, `${a.id}:duplicate`, async () => {
        duplicateEntered = true;
      })).rejects.toBeInstanceOf(OperationBusyError);
      expect(duplicateEntered).toBe(false);
      await withUserOperation(b.id, `${b.id}:independent`, async () => {
        await writeTransaction(db => db.checkIn.create({ data: { userId: b.id, date: "2026-01-01", weightKg: 70 } }));
        expect(aReleased).toBe(false);
      });
      expect(await prisma.checkIn.count({ where: { userId: b.id } })).toBe(1);
    } finally {
      aReleased = true;
      release.resolve();
      await first;
    }
  });

  it("fences a replaced worker before its write callback and preserves the new owner's lease", async () => {
    const user = await fixture();
    let callbackEntered = false;
    await withUserOperation(user.id, `${user.id}:stale`, async () => {
      await prisma.operationLease.update({ where: { key: `user:${user.id}` }, data: { token: "replacement-worker" } });
      await expect(writeTransaction(async db => {
        callbackEntered = true;
        return db.checkIn.create({ data: { userId: user.id, date: "2026-01-02", weightKg: 1 } });
      })).rejects.toBeInstanceOf(OperationBusyError);
    });
    expect(callbackEntered).toBe(false);
    expect(await prisma.checkIn.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.operationLease.findUniqueOrThrow({ where: { key: `user:${user.id}` } })).token).toBe("replacement-worker");
  });

  it("reacquires an expired lease with a new token and releases it after a successful retry", async () => {
    const user = await fixture();
    await prisma.operationLease.create({ data: { key: `user:${user.id}`, token: "expired-owner", expiresAt: new Date(0) } });
    await withUserOperation(user.id, `${user.id}:retry`, async () => {
      const lease = await prisma.operationLease.findUniqueOrThrow({ where: { key: `user:${user.id}` } });
      expect(lease.token).not.toBe("expired-owner");
      await writeTransaction(db => db.checkIn.create({ data: { userId: user.id, date: "2026-01-03", weightKg: 70 } }));
    });
    expect(await prisma.operationLease.findUnique({ where: { key: `user:${user.id}` } })).toBeNull();
    expect(await prisma.checkIn.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects an expired worker and frees its lease when a callback throws", async () => {
    const user = await fixture();
    await expect(withUserOperation(user.id, `${user.id}:expiry`, async () => {
      await prisma.operationLease.update({ where: { key: `user:${user.id}` }, data: { expiresAt: new Date(0) } });
      await writeTransaction(db => db.checkIn.create({ data: { userId: user.id, date: "2026-01-04", weightKg: 1 } }));
    })).rejects.toBeInstanceOf(OperationBusyError);
    expect(await prisma.operationLease.findUnique({ where: { key: `user:${user.id}` } })).toBeNull();
    await expect(withUserOperation(user.id, `${user.id}:after-failure`, async () => "retried")).resolves.toBe("retried");
    expect(await prisma.checkIn.count({ where: { userId: user.id } })).toBe(0);
  });
});
