BEGIN;
ALTER TYPE "PlanStatus" ADD VALUE 'NO_RESPONSE';
ALTER TYPE "EpisodicEventType" ADD VALUE 'PLAN_NO_RESPONSE';
ALTER TABLE "Message" ADD COLUMN "deliveryKey" TEXT;
ALTER TABLE "EpisodicLog" ADD COLUMN "eventKey" TEXT;
ALTER TABLE "PreferenceMemory" ADD COLUMN "lastDecayedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Message_deliveryKey_key" ON "Message"("deliveryKey");
CREATE UNIQUE INDEX "EpisodicLog_eventKey_key" ON "EpisodicLog"("eventKey");

-- Keep historical check-ins intact. Abort with an actionable error instead of
-- deleting duplicate personal records to make the new constraint fit.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "CheckIn" GROUP BY "userId", "date" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate daily CheckIn rows exist. Review and consolidate them before retrying this migration.';
  END IF;
END $$;
CREATE UNIQUE INDEX "CheckIn_userId_date_key" ON "CheckIn"("userId", "date");

CREATE TABLE "OperationLease" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PreferenceEvidence" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill one delivery key per existing slot; preserve any historical duplicates.
WITH ranked AS (
  SELECT m."id", CONCAT(m."userId", ':', COALESCE(p."date", TO_CHAR(m."createdAt" + INTERVAL '8 hours', 'YYYY-MM-DD')), ':',
    CASE WHEN m."require" = 'ASK_USER' THEN 'ASK_USER' ELSE m."type"::TEXT END) AS slot,
    ROW_NUMBER() OVER (PARTITION BY m."userId", COALESCE(p."date", TO_CHAR(m."createdAt" + INTERVAL '8 hours', 'YYYY-MM-DD')),
      CASE WHEN m."require" = 'ASK_USER' THEN 'ASK_USER' ELSE m."type"::TEXT END ORDER BY m."createdAt", m."id") AS rank
  FROM "Message" m LEFT JOIN "DailyPlan" p ON p."id" = m."planId"
)
UPDATE "Message" m SET "deliveryKey" = ranked.slot FROM ranked WHERE m."id" = ranked."id" AND ranked.rank = 1;
COMMIT;
