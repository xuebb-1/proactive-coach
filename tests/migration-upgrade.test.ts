import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = async (name: string) => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");

describe("upgrade from the existing beta schema", () => {
  it("keeps the existing check-in index and backfills local delivery slots without deleting history", async () => {
    const db = await PGlite.create();
    try {
      for (const name of ["20260817075120_init", "20260818073315_add_meal_knowledge_base", "20260828140500_beta_multi_user"]) {
        await db.exec(await migration(name));
      }
      await db.exec(`
        INSERT INTO "User" (id) VALUES ('shanghai'), ('new-york'), ('legacy-no-profile');
        INSERT INTO "UserProfile" (id, "userId", "goalWeightKg", "currentWeightKg", "dislikedFoods", "morningTime", "lunchTime", "eveningTime", timezone, "updatedAt") VALUES
          ('profile-sh', 'shanghai', 65, 70, '[]', '07:30', '12:00', '20:30', 'Asia/Shanghai', NOW()),
          ('profile-ny', 'new-york', 65, 70, '[]', '07:30', '12:00', '20:30', 'America/New_York', NOW());
        INSERT INTO "DailyPlan" (id, "userId", date, type, "updatedAt") VALUES ('scheduled-plan', 'shanghai', '2026-08-20', 'MORNING', NOW());
        INSERT INTO "CheckIn" (id, "userId", date) VALUES ('old-checkin', 'shanghai', '2026-08-20');
        INSERT INTO "Message" (id, "userId", "planId", type, text, require, payload, "dedupeKey", "createdAt") VALUES
          ('with-plan', 'shanghai', 'scheduled-plan', 'MORNING', 'old plan', 'CONFIRM_OR_SWAP', '{}', NULL, '2026-08-21 00:30:00'),
          ('queued-key', 'shanghai', NULL, 'LUNCH', 'queued', 'CONFIRM_OR_SKIP', '{}', 'agent-daily:shanghai:2026-08-19:lunch', '2026-08-21 00:30:00'),
          ('sh-local', 'shanghai', NULL, 'EVENING', 'local date', 'NONE', '{}', NULL, '2026-08-20 16:30:00'),
          ('ny-local', 'new-york', NULL, 'MORNING', 'local date', 'NONE', '{}', NULL, '2026-08-21 00:30:00'),
          ('default-zone', 'legacy-no-profile', NULL, 'MORNING', 'default date', 'NONE', '{}', NULL, '2026-08-20 16:30:00'),
          ('historical-duplicate', 'shanghai', NULL, 'LUNCH', 'keep duplicate', 'NONE', '{}', NULL, '2026-08-19 02:00:00'),
          ('attribution', 'shanghai', 'scheduled-plan', 'MORNING', 'attribution', 'ASK_USER', '{"kind":"swap_attribution"}', NULL, '2026-08-20 09:00:00'),
          ('model-ask', 'new-york', NULL, 'LUNCH', 'model question', 'ASK_USER', '{"options":["A","B"]}', NULL, '2026-08-20 16:00:00'),
          ('model-ask-duplicate', 'new-york', NULL, 'LUNCH', 'later lunch', 'NONE', '{}', NULL, '2026-08-20 17:00:00');
      `);
      const before = await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname = 'CheckIn_userId_date_key'`);
      expect(before.rows).toHaveLength(1);
      await db.exec(await migration("20261026000100_reliability_beta"));

      const rows = await db.query<{ id: string; deliveryKey: string | null }>(`SELECT id, "deliveryKey" FROM "Message" ORDER BY id`);
      expect(Object.fromEntries(rows.rows.map(row => [row.id, row.deliveryKey]))).toEqual({
        "with-plan": "shanghai:2026-08-20:MORNING",
        "queued-key": "shanghai:2026-08-19:LUNCH",
        "sh-local": "shanghai:2026-08-21:EVENING",
        "ny-local": "new-york:2026-08-20:MORNING",
        "default-zone": "legacy-no-profile:2026-08-21:MORNING",
        "historical-duplicate": null,
        attribution: "shanghai:2026-08-20:ASK_USER",
        "model-ask": "new-york:2026-08-20:LUNCH",
        "model-ask-duplicate": null,
      });
      expect(rows.rows).toHaveLength(9);
      expect((await db.query(`SELECT * FROM "CheckIn" WHERE id = 'old-checkin'`)).rows).toHaveLength(1);
      expect((await db.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'CheckIn_userId_date_key'`)).rows).toHaveLength(1);
      await expect(db.exec(`INSERT INTO "CheckIn" (id, "userId", date) VALUES ('duplicate-checkin', 'shanghai', '2026-08-20')`)).rejects.toThrow();
      await expect(db.exec(`INSERT INTO "Message" (id, "userId", type, text, require, payload, "deliveryKey") VALUES ('duplicate-delivery', 'shanghai', 'LUNCH', 'duplicate', 'NONE', '{}', 'shanghai:2026-08-19:LUNCH')`)).rejects.toThrow();
      await expect(db.exec(`INSERT INTO "Message" (id, "userId", type, text, require, payload, "deliveryKey") VALUES ('duplicate-model-ask-slot', 'new-york', 'LUNCH', 'retry', 'NONE', '{}', 'new-york:2026-08-20:LUNCH')`)).rejects.toThrow();
    } finally { await db.close(); }
  });
});
