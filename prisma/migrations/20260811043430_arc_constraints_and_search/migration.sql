-- Constraints and indexes that the Prisma schema language cannot express.
--
-- 1. Exclusive-arc CHECK constraints. NoteLink and Milestone each point at
--    exactly one parent through several nullable FKs. Without these constraints
--    a row could reference two parents at once, or none at all, and the
--    application would silently produce orphaned links.
--
-- 2. Trigram indexes backing global search. LifeOS searches titles and bodies
--    with ILIKE '%term%', which cannot use a B-tree index; without pg_trgm every
--    search is a sequential scan over the user's entire corpus.

-- ---------------------------------------------------------------------------
-- Exclusive arcs
-- ---------------------------------------------------------------------------

ALTER TABLE "note_links"
  ADD CONSTRAINT "note_links_exactly_one_target"
  CHECK (
    (("taskId" IS NOT NULL)::int
     + ("projectId" IS NOT NULL)::int
     + ("goalId" IS NOT NULL)::int) = 1
  );

ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_exactly_one_parent"
  CHECK (
    (("goalId" IS NOT NULL)::int
     + ("projectId" IS NOT NULL)::int) = 1
  );

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------

-- Mood and productivity are 1..5 scales; the UI enforces it but the database is
-- the only place that holds when a bug or the AI executor writes directly.
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_mood_range" CHECK ("mood" IS NULL OR ("mood" BETWEEN 1 AND 5)),
  ADD CONSTRAINT "journal_productivity_range" CHECK ("productivity" IS NULL OR ("productivity" BETWEEN 1 AND 5));

-- Goal progress is a percentage.
ALTER TABLE "goal_progress"
  ADD CONSTRAINT "goal_progress_percent_range" CHECK ("percent" BETWEEN 0 AND 100);

-- An event cannot end before it starts.
ALTER TABLE "events"
  ADD CONSTRAINT "events_end_after_start" CHECK ("endAt" >= "startAt");

-- A budget period cannot end before it starts.
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_period_ordered" CHECK ("periodEnd" >= "periodStart");

-- Amounts are minor units and must be non-negative; direction is carried by
-- `kind` (EXPENSE/INCOME), not by the sign, so a negative amount is a bug.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_non_negative" CHECK ("amountMinor" >= 0);

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_limit_non_negative" CHECK ("limitMinor" >= 0);

-- A task cannot be its own parent or its own recurrence series.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id"),
  ADD CONSTRAINT "tasks_no_self_series" CHECK ("seriesId" IS NULL OR "seriesId" <> "id");

-- ---------------------------------------------------------------------------
-- Search indexes
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "tasks_title_trgm" ON "tasks" USING gin ("title" gin_trgm_ops);
CREATE INDEX "projects_name_trgm" ON "projects" USING gin ("name" gin_trgm_ops);
CREATE INDEX "notes_title_trgm" ON "notes" USING gin ("title" gin_trgm_ops);
CREATE INDEX "notes_content_trgm" ON "notes" USING gin ("content" gin_trgm_ops);
CREATE INDEX "goals_title_trgm" ON "goals" USING gin ("title" gin_trgm_ops);
CREATE INDEX "journal_content_trgm" ON "journal_entries" USING gin ("content" gin_trgm_ops);
CREATE INDEX "expenses_description_trgm" ON "expenses" USING gin ("description" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Dashboard query support
-- ---------------------------------------------------------------------------

-- "Today's tasks" and "overdue" both filter on incomplete tasks ordered by due
-- date. A partial index keeps the completed backlog out of the hot path.
CREATE INDEX "tasks_open_due" ON "tasks" ("userId", "dueAt")
  WHERE "status" NOT IN ('DONE', 'CANCELLED') AND "isTemplate" = false;

-- Habit streak computation walks completions backwards from today per habit.
CREATE INDEX "habit_completions_streak" ON "habit_completions" ("habitId", "completedOn" DESC);

-- Monthly spend rollups group by category within a date window.
CREATE INDEX "expenses_month_rollup" ON "expenses" ("userId", "spentOn", "categoryId");

-- Expiring AI plans are swept by status + expiry.
CREATE INDEX "ai_plans_pending_expiry" ON "ai_command_plans" ("expiresAt")
  WHERE "status" = 'PENDING';
