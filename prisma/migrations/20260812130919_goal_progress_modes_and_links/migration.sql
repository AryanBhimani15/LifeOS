-- CreateEnum
CREATE TYPE "GoalProgressMode" AS ENUM ('MANUAL', 'NUMERIC', 'MILESTONES', 'TASKS');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "category" TEXT,
ADD COLUMN     "currentMilli" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "manualPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "progressMode" "GoalProgressMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "targetMilli" BIGINT,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "habits" ADD COLUMN     "goalId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "goalId" TEXT;

-- CreateIndex
CREATE INDEX "habits_goalId_idx" ON "habits"("goalId");

-- CreateIndex
CREATE INDEX "tasks_goalId_idx" ON "tasks"("goalId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
