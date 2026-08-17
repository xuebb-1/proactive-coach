-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('MORNING', 'LUNCH', 'EVENING');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SWAPPED', 'COMPLETED', 'SKIPPED', 'AUTO_ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MessageRequire" AS ENUM ('CONFIRM_OR_SWAP', 'CONFIRM_OR_SKIP', 'CHECKIN', 'ASK_USER', 'NONE');

-- CreateEnum
CREATE TYPE "EpisodicEventType" AS ENUM ('PLAN_GENERATED', 'ACTION_CONFIRM', 'ACTION_SWAP', 'ACTION_COMPLETE', 'ACTION_SKIP', 'CHECKIN', 'AUTO_ACCEPTED', 'ASK_USER_RESPONDED');

-- CreateEnum
CREATE TYPE "AgentTraceSource" AS ENUM ('REAL', 'MOCK', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "AgentTraceStatus" AS ENUM ('COMPLETE', 'INCOMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalWeightKg" DOUBLE PRECISION NOT NULL,
    "currentWeightKg" DOUBLE PRECISION NOT NULL,
    "dislikedFoods" TEXT NOT NULL,
    "eatingMode" TEXT NOT NULL DEFAULT 'canteen',
    "morningTime" TEXT NOT NULL,
    "lunchTime" TEXT NOT NULL,
    "eveningTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tonePreference" TEXT NOT NULL,
    "motivationHook" TEXT NOT NULL,
    "eventLabel" TEXT,
    "eventDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" "PlanType" NOT NULL,
    "mealKey" TEXT,
    "mealTitle" TEXT,
    "kcal" INTEGER,
    "status" "PlanStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "type" "PlanType" NOT NULL,
    "text" TEXT NOT NULL,
    "require" "MessageRequire" NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodicLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "EpisodicEventType" NOT NULL,
    "planType" "PlanType",
    "mealKey" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodicLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "difficulty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenceMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "source" "AgentTraceSource" NOT NULL,
    "status" "AgentTraceStatus" NOT NULL DEFAULT 'COMPLETE',
    "steps" TEXT NOT NULL,
    "finalMessageId" TEXT,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaProfile_userId_key" ON "PersonaProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlan_userId_date_type_key" ON "DailyPlan"("userId", "date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceMemory_userId_key_key" ON "PreferenceMemory"("userId", "key");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaProfile" ADD CONSTRAINT "PersonaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DailyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodicLog" ADD CONSTRAINT "EpisodicLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceMemory" ADD CONSTRAINT "PreferenceMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrace" ADD CONSTRAINT "AgentTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
