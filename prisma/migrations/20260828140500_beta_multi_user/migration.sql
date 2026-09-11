-- AlterTable
ALTER TABLE "User" ADD COLUMN "clerkId" TEXT;

-- AlterTable
ALTER TABLE "UserProfile"
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
ADD COLUMN "scenarioId" TEXT NOT NULL DEFAULT 'weightloss';

-- AlterTable
ALTER TABLE "Meal" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "AgentTrace"
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "stepCount" INTEGER,
ADD COLUMN "model" TEXT,
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "delivery" TEXT,
ADD COLUMN "failureKind" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_userId_date_key" ON "CheckIn"("userId", "date");

-- ReplaceIndex
DROP INDEX "Meal_mode_isActive_idx";
CREATE INDEX "Meal_mode_isActive_ownerId_idx" ON "Meal"("mode", "isActive", "ownerId");

-- AddForeignKey
ALTER TABLE "Meal"
ADD CONSTRAINT "Meal_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
