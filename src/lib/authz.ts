import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Ownership checks must be able to run INSIDE a transaction. Using the global
 * client from within an interactive transaction opens a second connection that
 * cannot see the transaction's own uncommitted rows, so callers pass their `tx`.
 */
export type DbClient = typeof db | Prisma.TransactionClient;

/**
 * Ownership enforcement.
 *
 * Every row in LifeOS carries `userId`, and every query must be scoped to the
 * signed-in user. Scoping the *top-level* where clause is not sufficient on its
 * own: Prisma nested writes accept foreign ids that the top-level filter never
 * inspects. This is a real cross-tenant hole:
 *
 *     db.task.update({
 *       where: { id: myTaskId, userId: me },      // ← checked
 *       data:  { project: { connect: { id: X } } } // ← NOT checked
 *     })
 *
 * The update succeeds and attaches another user's project to my task.
 *
 * LifeOS closes this two ways:
 *   1. Repositories never pass user-supplied ids into nested `connect`. They
 *      assign scalar foreign keys (projectId) instead.
 *   2. Every such foreign key is verified with `requireOwned` before the write.
 *
 * Rule for anyone adding a feature: if an id came from a request body, it goes
 * through this module before it reaches the database.
 */

/** Models a client may reference by id in a request payload. */
export type OwnedModel =
  | "project"
  | "task"
  | "note"
  | "noteFolder"
  | "goal"
  | "habit"
  | "event"
  | "expense"
  | "expenseCategory"
  | "budget"
  | "tag"
  | "journalEntry"
  | "document"
  | "recurrenceRule";

const LABELS: Record<OwnedModel, string> = {
  project: "Project",
  task: "Task",
  note: "Note",
  noteFolder: "Folder",
  goal: "Goal",
  habit: "Habit",
  event: "Event",
  expense: "Expense",
  expenseCategory: "Category",
  budget: "Budget",
  tag: "Tag",
  journalEntry: "Journal entry",
  document: "Document",
  recurrenceRule: "Recurrence rule",
};

/**
 * Counts rows matching (id, userId). Each delegate is named explicitly rather
 * than indexed dynamically so that a typo becomes a TypeScript error instead of
 * an ownership check that silently passes at runtime.
 */
const COUNTERS: Record<OwnedModel, (c: DbClient, id: string, userId: string) => Promise<number>> = {
  project: (c, id, userId) => c.project.count({ where: { id, userId } }),
  task: (c, id, userId) => c.task.count({ where: { id, userId } }),
  note: (c, id, userId) => c.note.count({ where: { id, userId } }),
  noteFolder: (c, id, userId) => c.noteFolder.count({ where: { id, userId } }),
  goal: (c, id, userId) => c.goal.count({ where: { id, userId } }),
  habit: (c, id, userId) => c.habit.count({ where: { id, userId } }),
  event: (c, id, userId) => c.event.count({ where: { id, userId } }),
  expense: (c, id, userId) => c.expense.count({ where: { id, userId } }),
  expenseCategory: (c, id, userId) => c.expenseCategory.count({ where: { id, userId } }),
  budget: (c, id, userId) => c.budget.count({ where: { id, userId } }),
  tag: (c, id, userId) => c.tag.count({ where: { id, userId } }),
  journalEntry: (c, id, userId) => c.journalEntry.count({ where: { id, userId } }),
  document: (c, id, userId) => c.document.count({ where: { id, userId } }),
  recurrenceRule: (c, id, userId) => c.recurrenceRule.count({ where: { id, userId } }),
};

/**
 * Throws 404 unless `id` exists AND belongs to `userId`.
 *
 * 404 rather than 403 on purpose — see the comment on `notFound` in errors.ts.
 */
export async function requireOwned(
  model: OwnedModel,
  id: string,
  userId: string,
  client: DbClient = db,
): Promise<void> {
  const count = await COUNTERS[model](client, id, userId);
  if (count === 0) throw notFound(LABELS[model]);
}

/** Same as requireOwned, but skips null/undefined so optional fields are ergonomic. */
export async function requireOwnedIfPresent(
  model: OwnedModel,
  id: string | null | undefined,
  userId: string,
  client: DbClient = db,
): Promise<void> {
  if (id === null || id === undefined) return;
  await requireOwned(model, id, userId, client);
}

/**
 * Verifies every id in a batch belongs to the user, in one query per model
 * rather than one per id — a task with twelve tags should not cost twelve
 * round trips.
 */
export async function requireAllOwned(
  model: OwnedModel,
  ids: readonly string[],
  userId: string,
  client: DbClient = db,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;

  const found = await COUNT_MANY[model](client, unique, userId);
  if (found !== unique.length) throw notFound(LABELS[model]);
}

const COUNT_MANY: Record<OwnedModel, (c: DbClient, ids: string[], userId: string) => Promise<number>> = {
  project: (c, ids, userId) => c.project.count({ where: { id: { in: ids }, userId } }),
  task: (c, ids, userId) => c.task.count({ where: { id: { in: ids }, userId } }),
  note: (c, ids, userId) => c.note.count({ where: { id: { in: ids }, userId } }),
  noteFolder: (c, ids, userId) => c.noteFolder.count({ where: { id: { in: ids }, userId } }),
  goal: (c, ids, userId) => c.goal.count({ where: { id: { in: ids }, userId } }),
  habit: (c, ids, userId) => c.habit.count({ where: { id: { in: ids }, userId } }),
  event: (c, ids, userId) => c.event.count({ where: { id: { in: ids }, userId } }),
  expense: (c, ids, userId) => c.expense.count({ where: { id: { in: ids }, userId } }),
  expenseCategory: (c, ids, userId) => c.expenseCategory.count({ where: { id: { in: ids }, userId } }),
  budget: (c, ids, userId) => c.budget.count({ where: { id: { in: ids }, userId } }),
  tag: (c, ids, userId) => c.tag.count({ where: { id: { in: ids }, userId } }),
  journalEntry: (c, ids, userId) => c.journalEntry.count({ where: { id: { in: ids }, userId } }),
  document: (c, ids, userId) => c.document.count({ where: { id: { in: ids }, userId } }),
  recurrenceRule: (c, ids, userId) => c.recurrenceRule.count({ where: { id: { in: ids }, userId } }),
};
