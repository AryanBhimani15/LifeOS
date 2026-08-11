-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'PAUSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "HabitCadence" AS ENUM ('DAILY', 'SPECIFIC_DAYS', 'TIMES_PER_WEEK');

-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'SIGNUP', 'EXPORT', 'ACCOUNT_DELETE', 'AI_PLAN', 'AI_EXECUTE', 'AI_REJECT', 'SETTINGS_CHANGE');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDING', 'EXECUTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "emailDigest" BOOLEAN NOT NULL DEFAULT false,
    "digestHour" INTEGER NOT NULL DEFAULT 7,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiModel" TEXT NOT NULL DEFAULT 'gemini-3.6-flash',
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_activities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "freq" "RecurrenceFreq" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byWeekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "byMonthday" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "atMinutes" INTEGER NOT NULL DEFAULT 540,
    "startsOn" DATE NOT NULL,
    "until" DATE,
    "count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimateMin" INTEGER,
    "boardOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recurrenceRuleId" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT,
    "occurrenceOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "recurrenceRuleId" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT,
    "occurrenceOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_folders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_links" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "goalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_tags" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "task_tags_pkey" PRIMARY KEY ("taskId","tagId")
);

-- CreateTable
CREATE TABLE "note_tags" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "note_tags_pkey" PRIMARY KEY ("noteId","tagId")
);

-- CreateTable
CREATE TABLE "project_tags" (
    "projectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("projectId","tagId")
);

-- CreateTable
CREATE TABLE "expense_tags" (
    "expenseId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "expense_tags_pkey" PRIMARY KEY ("expenseId","tagId")
);

-- CreateTable
CREATE TABLE "goal_tags" (
    "goalId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "goal_tags_pkey" PRIMARY KEY ("goalId","tagId")
);

-- CreateTable
CREATE TABLE "journal_tags" (
    "journalId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "journal_tags_pkey" PRIMARY KEY ("journalId","tagId")
);

-- CreateTable
CREATE TABLE "recurrence_exceptions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "cancelledOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cadence" "HabitCadence" NOT NULL DEFAULT 'DAILY',
    "targetPerWeek" INTEGER NOT NULL DEFAULT 7,
    "byWeekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "color" TEXT NOT NULL DEFAULT '#10b981',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_completions" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habit_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetDate" TIMESTAMP(3),
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "goalId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_progress" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "goalId" TEXT,
    "entryDate" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "mood" INTEGER,
    "productivity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#f59e0b',
    "icon" TEXT,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "kind" "ExpenseKind" NOT NULL DEFAULT 'EXPENSE',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "spentOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "limitMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_command_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "needsConfirm" BOOLEAN NOT NULL DEFAULT false,
    "status" "PlanStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_command_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE INDEX "projects_userId_status_idx" ON "projects"("userId", "status");

-- CreateIndex
CREATE INDEX "projects_userId_dueDate_idx" ON "projects"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "project_activities_projectId_createdAt_idx" ON "project_activities"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "recurrence_rules_userId_idx" ON "recurrence_rules"("userId");

-- CreateIndex
CREATE INDEX "tasks_userId_status_dueAt_idx" ON "tasks"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_userId_projectId_idx" ON "tasks"("userId", "projectId");

-- CreateIndex
CREATE INDEX "tasks_userId_dueAt_idx" ON "tasks"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_parentId_idx" ON "tasks"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_seriesId_occurrenceOn_key" ON "tasks"("seriesId", "occurrenceOn");

-- CreateIndex
CREATE INDEX "reminders_userId_remindAt_idx" ON "reminders"("userId", "remindAt");

-- CreateIndex
CREATE INDEX "reminders_taskId_idx" ON "reminders"("taskId");

-- CreateIndex
CREATE INDEX "events_userId_startAt_idx" ON "events"("userId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "events_seriesId_occurrenceOn_key" ON "events"("seriesId", "occurrenceOn");

-- CreateIndex
CREATE UNIQUE INDEX "note_folders_userId_name_key" ON "note_folders"("userId", "name");

-- CreateIndex
CREATE INDEX "notes_userId_updatedAt_idx" ON "notes"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "notes_userId_folderId_idx" ON "notes"("userId", "folderId");

-- CreateIndex
CREATE INDEX "note_links_taskId_idx" ON "note_links"("taskId");

-- CreateIndex
CREATE INDEX "note_links_projectId_idx" ON "note_links"("projectId");

-- CreateIndex
CREATE INDEX "note_links_goalId_idx" ON "note_links"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "note_links_noteId_taskId_key" ON "note_links"("noteId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "note_links_noteId_projectId_key" ON "note_links"("noteId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "note_links_noteId_goalId_key" ON "note_links"("noteId", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_name_key" ON "tags"("userId", "name");

-- CreateIndex
CREATE INDEX "task_tags_tagId_idx" ON "task_tags"("tagId");

-- CreateIndex
CREATE INDEX "note_tags_tagId_idx" ON "note_tags"("tagId");

-- CreateIndex
CREATE INDEX "project_tags_tagId_idx" ON "project_tags"("tagId");

-- CreateIndex
CREATE INDEX "expense_tags_tagId_idx" ON "expense_tags"("tagId");

-- CreateIndex
CREATE INDEX "goal_tags_tagId_idx" ON "goal_tags"("tagId");

-- CreateIndex
CREATE INDEX "journal_tags_tagId_idx" ON "journal_tags"("tagId");

-- CreateIndex
CREATE INDEX "recurrence_exceptions_ruleId_idx" ON "recurrence_exceptions"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "recurrence_exceptions_ruleId_cancelledOn_key" ON "recurrence_exceptions"("ruleId", "cancelledOn");

-- CreateIndex
CREATE INDEX "habits_userId_idx" ON "habits"("userId");

-- CreateIndex
CREATE INDEX "habit_completions_userId_completedOn_idx" ON "habit_completions"("userId", "completedOn");

-- CreateIndex
CREATE UNIQUE INDEX "habit_completions_habitId_completedOn_key" ON "habit_completions"("habitId", "completedOn");

-- CreateIndex
CREATE INDEX "goals_userId_status_idx" ON "goals"("userId", "status");

-- CreateIndex
CREATE INDEX "milestones_goalId_idx" ON "milestones"("goalId");

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "goal_progress_goalId_recordedAt_idx" ON "goal_progress"("goalId", "recordedAt");

-- CreateIndex
CREATE INDEX "journal_entries_userId_entryDate_idx" ON "journal_entries"("userId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_userId_entryDate_key" ON "journal_entries"("userId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_userId_name_key" ON "expense_categories"("userId", "name");

-- CreateIndex
CREATE INDEX "expenses_userId_spentOn_idx" ON "expenses"("userId", "spentOn");

-- CreateIndex
CREATE INDEX "expenses_userId_categoryId_idx" ON "expenses"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "budgets_userId_periodStart_idx" ON "budgets"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "documents_userId_createdAt_idx" ON "documents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_command_plans_userId_createdAt_idx" ON "ai_command_plans"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_command_plans_status_expiresAt_idx" ON "ai_command_plans"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_folders" ADD CONSTRAINT "note_folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "note_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tags" ADD CONSTRAINT "expense_tags_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tags" ADD CONSTRAINT "expense_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_tags" ADD CONSTRAINT "goal_tags_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_tags" ADD CONSTRAINT "goal_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_tags" ADD CONSTRAINT "journal_tags_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_tags" ADD CONSTRAINT "journal_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_exceptions" ADD CONSTRAINT "recurrence_exceptions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "recurrence_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_progress" ADD CONSTRAINT "goal_progress_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_command_plans" ADD CONSTRAINT "ai_command_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
