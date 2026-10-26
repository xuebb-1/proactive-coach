BEGIN;
ALTER TYPE "PlanStatus" ADD VALUE 'NO_RESPONSE';
ALTER TYPE "EpisodicEventType" ADD VALUE 'PLAN_NO_RESPONSE';
ALTER TABLE "Message" ADD COLUMN "deliveryKey" TEXT;
ALTER TABLE "EpisodicLog" ADD COLUMN "eventKey" TEXT;
ALTER TABLE "PreferenceMemory" ADD COLUMN "lastDecayedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Message_deliveryKey_key" ON "Message"("deliveryKey");
CREATE UNIQUE INDEX "EpisodicLog_eventKey_key" ON "EpisodicLog"("eventKey");

-- CheckIn's daily uniqueness constraint already exists in beta_multi_user.
-- Keep that applied migration intact rather than recreating its index.
CREATE TABLE "OperationLease" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PreferenceEvidence" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Preserve historical duplicates, but reserve one delivery per logical slot.
-- A queued beta message's dedupeKey carries its scheduled local date. Older
-- messages without that key use their plan or the owner's local calendar day.
-- Old model ask_user messages have no dedupeKey either. Only the structured
-- swap attribution intent owns the separate ASK_USER slot. Match the stored
-- JSON field without casting so malformed legacy payloads do not abort upgrades.
WITH slots AS (
  SELECT m."id", m."createdAt", m."dedupeKey",
    CONCAT(m."userId", ':',
      COALESCE(p."date",
        SUBSTRING(m."dedupeKey" FROM ':([0-9]{4}-[0-9]{2}-[0-9]{2}):(morning|lunch|evening)$'),
        TO_CHAR(m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE COALESCE(NULLIF(up."timezone", ''), 'Asia/Shanghai'), 'YYYY-MM-DD')),
      ':', CASE WHEN m."require" = 'ASK_USER'
        AND m."payload" ~ '"kind"[[:space:]]*:[[:space:]]*"swap_attribution"'
        THEN 'ASK_USER' ELSE m."type"::TEXT END) AS slot
  FROM "Message" m
  LEFT JOIN "DailyPlan" p ON p."id" = m."planId"
  LEFT JOIN "UserProfile" up ON up."userId" = m."userId"
), ranked AS (
  SELECT "id", slot,
    ROW_NUMBER() OVER (PARTITION BY slot ORDER BY ("dedupeKey" IS NOT NULL) DESC, "createdAt", "id") AS rank
  FROM slots
)
UPDATE "Message" m SET "deliveryKey" = ranked.slot
FROM ranked WHERE m."id" = ranked."id" AND ranked.rank = 1;
COMMIT;
