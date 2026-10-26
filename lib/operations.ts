import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import type { Prisma } from "@/app/generated/prisma/client";

type Operation = { key: string; token: string; eventKey: string };
const context = new AsyncLocalStorage<Operation>();
const transaction = new AsyncLocalStorage<Prisma.TransactionClient>();

export class OperationBusyError extends Error {
  constructor() { super("正在处理上一项操作，请稍候再试。"); }
}

export function currentEventKey() { return context.getStore()?.eventKey; }

/** A database lease spans model calls without holding a database transaction open. */
export async function withUserOperation<T>(userId: string, eventKey: string, fn: () => Promise<T>): Promise<T> {
  const key = `user:${userId}`;
  const active = context.getStore();
  if (active) {
    if (active.key !== key) throw new Error("Operation user mismatch");
    return context.run({ ...active, eventKey }, fn);
  }
  const token = randomUUID();
  const acquired = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "OperationLease" ("key", "token", "expiresAt")
    VALUES (${key}, ${token}, NOW() + INTERVAL '5 minutes')
    ON CONFLICT ("key") DO UPDATE SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "OperationLease"."expiresAt" < NOW()
    RETURNING "key"
  `;
  if (!acquired.length) throw new OperationBusyError();
  try {
    return await context.run({ key, token, eventKey }, fn);
  } finally {
    await prisma.operationLease.deleteMany({ where: { key, token } });
  }
}

/** Check the lease inside each short write transaction: expired workers cannot write late results. */
export async function writeTransaction<T>(fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const existing = transaction.getStore();
  if (existing) return fn(existing);
  return prisma.$transaction(async (db) => {
    const active = context.getStore();
    if (active) {
      const owned = await db.$queryRaw<Array<{ key: string }>>`
        SELECT "key" FROM "OperationLease"
        WHERE "key" = ${active.key} AND "token" = ${active.token} AND "expiresAt" > NOW()
        FOR UPDATE
      `;
      if (!owned.length) throw new OperationBusyError();
    }
    return transaction.run(db, () => fn(db));
  }, { timeout: 10000 });
}
