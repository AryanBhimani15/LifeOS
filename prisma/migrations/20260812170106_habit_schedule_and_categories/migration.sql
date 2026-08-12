-- CreateEnum
CREATE TYPE "HabitCategory" AS ENUM ('HEALTH', 'MIND', 'STUDY', 'PERSONAL', 'OTHER');

-- AlterTable
ALTER TABLE "habits" ADD COLUMN     "category" "HabitCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "reminderMinutes" INTEGER,
ADD COLUMN     "startedOn" DATE;
