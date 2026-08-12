-- CreateEnum
CREATE TYPE "LifeContext" AS ENUM ('STUDENT', 'PROFESSIONAL', 'STUDENT_AND_WORKING', 'OTHER');

-- CreateEnum
CREATE TYPE "PrimaryGoal" AS ENUM ('LOSE_WEIGHT', 'BUILD_STRENGTH', 'IMPROVE_ENDURANCE', 'STAY_HEALTHY');

-- AlterTable
ALTER TABLE "fitness_profiles" ADD COLUMN     "lifeContext" "LifeContext" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "primaryGoal" "PrimaryGoal" NOT NULL DEFAULT 'STAY_HEALTHY';

-- AlterTable
ALTER TABLE "workout_entries" ADD COLUMN     "planSessionId" TEXT;

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryGoal" "PrimaryGoal" NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_sessions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "activityId" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "activityIcon" TEXT NOT NULL,
    "caloriesPerHour" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "focus" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workout_plan_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workout_plans_userId_archivedAt_idx" ON "workout_plans"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "workout_plan_sessions_planId_dayOfWeek_idx" ON "workout_plan_sessions"("planId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "workout_plan_sessions_activityId_idx" ON "workout_plan_sessions"("activityId");

-- CreateIndex
CREATE INDEX "workout_entries_planSessionId_idx" ON "workout_entries"("planSessionId");

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_sessions" ADD CONSTRAINT "workout_plan_sessions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_sessions" ADD CONSTRAINT "workout_plan_sessions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_entries" ADD CONSTRAINT "workout_entries_planSessionId_fkey" FOREIGN KEY ("planSessionId") REFERENCES "workout_plan_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
