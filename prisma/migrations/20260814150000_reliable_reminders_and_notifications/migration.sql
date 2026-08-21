-- A Reminder remains the scheduled instruction. Its delivery lifecycle is
-- explicit so a repeated scheduler run cannot generate repeated alerts.
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'CANCELLED');

ALTER TABLE "reminders"
  ADD COLUMN "relativeMinutesBefore" INTEGER,
  ADD COLUMN "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve the meaning of any legacy sent reminder before the new state is
-- consulted by the delivery worker.
UPDATE "reminders" SET "status" = 'DELIVERED' WHERE "sentAt" IS NOT NULL;

CREATE INDEX "reminders_status_remindAt_idx" ON "reminders"("status", "remindAt");
CREATE INDEX "reminders_status_retryAt_idx" ON "reminders"("status", "retryAt");

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reminderId" TEXT NOT NULL,
  "deliveryVersion" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_reminderId_deliveryVersion_key"
  ON "notifications"("reminderId", "deliveryVersion");
CREATE INDEX "notifications_userId_readAt_createdAt_idx"
  ON "notifications"("userId", "readAt", "createdAt");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_reminderId_fkey"
  FOREIGN KEY ("reminderId") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
