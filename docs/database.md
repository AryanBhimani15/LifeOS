# Database

35 tables. `prisma/schema.prisma` is the source of truth; this document explains
the parts whose reasoning is not obvious from the schema.

## Conventions

- Every user-owned row carries `userId` and cascades from `User`, so account
  deletion is a single delete that leaves no orphans (verified by test).
- Timestamps: `createdAt` / `updatedAt` on every mutable entity.
- Ids are `cuid()`.
- Money is `Int` minor units, never a float.
- `@db.Date` columns store midnight UTC and carry no time component.

## Entity groups

| Group | Tables |
|---|---|
| Auth | `users`, `accounts`, `sessions`, `verification_tokens`, `user_settings` |
| Work | `projects`, `project_activities`, `tasks`, `reminders`, `recurrence_rules`, `recurrence_exceptions` |
| | `tasks.dueHasTime` separates "by Friday" from "at 6pm Friday"; `events.taskId` links a task to an exam or meeting without duplicating either |
| Calendar | `events` |
| Knowledge | `notes`, `note_folders`, `note_links` |
| Tags | `tags` + `task_tags`, `note_tags`, `project_tags`, `expense_tags`, `goal_tags`, `journal_tags` |
| Growth | `goals`, `milestones`, `goal_progress`, `habits`, `habit_completions`, `journal_entries` |
| Money | `expenses`, `expense_categories`, `budgets` |
| Fitness | `fitness_profiles`, `activities`, `workout_plans`, `workout_plan_sessions`, `workout_entries` |
| Other | `documents` (attachments; optional `eventId`), `ai_command_plans`, `audit_logs` |

## Relationship patterns

**Tags — one join table per entity.** Composite primary keys, no nullable
columns, dense indexes. See ADR-001 for why this beat both a polymorphic table
and a single wide table with six nullable foreign keys.

**Exclusive arcs — `note_links`, `milestones`.** Several nullable foreign keys
with a CHECK constraint that exactly one is set. Used only where there are two
or three possible parents. Prisma cannot express this, so the constraint lives
in migration SQL.

**Reference data — `activities`.** The only table here that is not user-owned.
Its twelve rows are inserted by the migration that creates it, so a fresh
deployment has a working calculator without anyone running a seed script. The
same list is mirrored in `prisma/activities.ts` for tests to restore after they
truncate; `tests/fitness.test.ts` asserts the two still agree.

**Denormalised history — `workout_entries`.** Each row copies the activity's
name, icon and rate rather than joining at read time, and `activityId` is
`SetNull` rather than `Cascade`. History is a record of what the user was told
at the time; re-pricing an old entry because the catalogue changed would rewrite
their past.

**Measurements — `fitness_profiles`.** Height and weight are integer millimetres
and grams for the same reason money is stored in minor units: both are entered
in one unit system and read back in another, so every value round-trips through
a conversion, and floats accumulate error across those trips until 5′10″ comes
back as 5′9″.

**Recurrence.** A rule, a template task (`isTemplate`), and instances linked by
`seriesId`. `@@unique([seriesId, occurrenceOn])` makes lazy expansion idempotent.
`seriesId` is `SetNull` on delete, not `Cascade` — cascading would destroy
completed history when a template is removed. `recurrence_exceptions` tombstones
occurrences the user deleted so expansion cannot resurrect them.

## Constraints beyond the schema

Applied in `prisma/migrations/*_arc_constraints_and_search/migration.sql`:

- `note_links_exactly_one_target`, `milestones_exactly_one_parent`
- `journal_mood_range`, `journal_productivity_range` (1–5)
- `goal_progress_percent_range` (0–100)
- `events_end_after_start`, `budgets_period_ordered`
- `expenses_amount_non_negative`, `budgets_limit_non_negative`
- `tasks_no_self_parent`, `tasks_no_self_series`

Applied in `prisma/migrations/*_fitness_onboarding_and_calorie_burn/migration.sql`:

- `fitness_profiles_age_range` (13–120), `fitness_profiles_height_range`,
  `fitness_profiles_weight_range`, `fitness_profiles_first_name_present`
- `workout_entries_duration_range` (1–1440 minutes),
  `workout_entries_rate_positive`, `workout_entries_burn_positive`
- `activities_rate_positive`

These restate the bounds the zod schemas enforce. Validation protects the user
from a typo; the constraints protect the data from a code path that forgot to
validate.

All verified by inserting violating rows and asserting rejection, plus a
negative control asserting valid rows are accepted.

## Indexes

**Search** — `pg_trgm` GIN indexes on task/project/note/goal titles and note,
journal, and expense bodies. `ILIKE '%term%'` cannot use a B-tree, so without
these every search is a sequential scan.

**Dashboard** — partial indexes matching the queries that actually run:

```sql
tasks_open_due            ON tasks(userId, dueAt)
                          WHERE status NOT IN ('DONE','CANCELLED') AND isTemplate = false
habit_completions_streak  ON habit_completions(habitId, completedOn DESC)
expenses_month_rollup     ON expenses(userId, spentOn, categoryId)
ai_plans_pending_expiry   ON ai_command_plans(expiresAt) WHERE status = 'PENDING'
```

## Migrations

```bash
npm run db:migrate          # create + apply in development
npm run db:migrate:test     # apply to the test database
npx prisma migrate deploy   # production
```

Migrations are never edited after being applied. Raw SQL for constraints Prisma
cannot express goes in a `--create-only` migration, filled in by hand.
