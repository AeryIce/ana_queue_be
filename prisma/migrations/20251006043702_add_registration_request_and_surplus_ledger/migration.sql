-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RegistrationRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wa" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MASTER',
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "isMasterMatch" BOOLEAN,
    "masterQuota" INTEGER,
    "issuedBefore" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurplusLedger" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "refRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurplusLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationRequest_eventId_status_createdAt_idx" ON "RegistrationRequest"("eventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SurplusLedger_eventId_createdAt_idx" ON "SurplusLedger"("eventId", "createdAt");
