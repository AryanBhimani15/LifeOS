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
| Calendar | `events` |
| Knowledge | `notes`, `note_folders`, `note_links` |
| Tags | `tags` + `task_tags`, `note_tags`, `project_tags`, `expense_tags`, `goal_tags`, `journal_tags` |
| Growth | `goals`, `milestones`, `goal_progress`, `habits`, `habit_completions`, `journal_entries` |
| Money | `expenses`, `expense_categories`, `budgets` |
| Other | `documents`, `ai_command_plans`, `audit_logs` |

## Relationship patterns

**Tags — one join table per entity.** Composite primary keys, no nullable
columns, dense indexes. See ADR-001 for why this beat both a polymorphic table
and a single wide table with six nullable foreign keys.

**Exclusive arcs — `note_links`, `milestones`.** Several nullable foreign keys
with a CHECK constraint that exactly one is set. Used only where there are two
or three possible parents. Prisma cannot express this, so the constraint lives
in migration SQL.

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
