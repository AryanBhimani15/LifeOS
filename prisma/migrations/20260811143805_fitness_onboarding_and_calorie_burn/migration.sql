-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTREMELY_ACTIVE');

-- CreateTable
CREATE TABLE "fitness_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "sex" "Sex" NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "weightGrams" INTEGER NOT NULL,
    "activityLevel" "ActivityLevel" NOT NULL,
    "heightUnit" TEXT NOT NULL DEFAULT 'cm',
    "weightUnit" TEXT NOT NULL DEFAULT 'kg',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fitness_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "caloriesPerHour" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "activityName" TEXT NOT NULL,
    "activityIcon" TEXT NOT NULL,
    "caloriesPerHour" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "caloriesBurned" INTEGER NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fitness_profiles_userId_key" ON "fitness_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "activities_slug_key" ON "activities"("slug");

-- CreateIndex
CREATE INDEX "activities_archived_sortOrder_idx" ON "activities"("archived", "sortOrder");

-- CreateIndex
CREATE INDEX "workout_entries_userId_performedAt_idx" ON "workout_entries"("userId", "performedAt");

-- CreateIndex
CREATE INDEX "workout_entries_activityId_idx" ON "workout_entries"("activityId");

-- AddForeignKey
ALTER TABLE "fitness_profiles" ADD CONSTRAINT "fitness_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_entries" ADD CONSTRAINT "workout_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_entries" ADD CONSTRAINT "workout_entries_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity constraints
--
-- The same bounds the zod schemas enforce, restated where they cannot be
-- bypassed. Validation protects the user from a typo; these protect the data
-- from a bug in a code path that forgot to validate.
-- ---------------------------------------------------------------------------

ALTER TABLE "fitness_profiles"
  ADD CONSTRAINT "fitness_profiles_age_range" CHECK ("age" >= 13 AND "age" <= 120),
  ADD CONSTRAINT "fitness_profiles_height_range" CHECK ("heightMm" >= 500 AND "heightMm" <= 2600),
  ADD CONSTRAINT "fitness_profiles_weight_range" CHECK ("weightGrams" >= 20000 AND "weightGrams" <= 500000),
  ADD CONSTRAINT "fitness_profiles_first_name_present" CHECK (length(btrim("firstName")) > 0);

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_rate_positive" CHECK ("caloriesPerHour" > 0);

-- A zero-minute workout is the exact case the UI refuses; the table refuses it too.
ALTER TABLE "workout_entries"
  ADD CONSTRAINT "workout_entries_duration_range" CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440),
  ADD CONSTRAINT "workout_entries_rate_positive" CHECK ("caloriesPerHour" > 0),
  ADD CONSTRAINT "workout_entries_burn_positive" CHECK ("caloriesBurned" >= 0);

-- ---------------------------------------------------------------------------
-- Activity catalogue
--
-- Reference data, so it ships with the migration rather than with the demo
-- seed: a fresh deployment has a working calculator without anyone running an
-- extra script. Ids are stable slugs, which makes this re-runnable and keeps
-- history readable in the database.
-- ---------------------------------------------------------------------------

INSERT INTO "activities" ("id", "slug", "name", "icon", "caloriesPerHour", "sortOrder") VALUES
  ('act_walking',         'walking',         'Walking',         'walk',     250,  10),
  ('act_yoga',            'yoga',            'Yoga',            'yoga',     200,  20),
  ('act_weight_training', 'weight-training', 'Weight Training', 'weights',  350,  30),
  ('act_dancing',         'dancing',         'Dancing',         'dance',    400,  40),
  ('act_hiking',          'hiking',          'Hiking',          'hike',     400,  50),
  ('act_jogging',         'jogging',         'Jogging',         'jog',      450,  60),
  ('act_cycling',         'cycling',         'Cycling',         'bike',     500,  70),
  ('act_basketball',      'basketball',      'Basketball',      'ball',     500,  80),
  ('act_swimming',        'swimming',        'Swimming',        'swim',     550,  90),
  ('act_running',         'running',         'Running',         'run',      600, 100),
  ('act_football',        'football',        'Football',        'football', 600, 110),
  ('act_jump_rope',       'jump-rope',       'Jump Rope',       'rope',     700, 120)
ON CONFLICT ("id") DO NOTHING;
