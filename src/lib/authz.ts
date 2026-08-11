import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";

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
const COUNTERS: Record<OwnedModel, (id: string, userId: string) => Promise<number>> = {
  project: (id, userId) => db.project.count({ where: { id, userId } }),
  task: (id, userId) => db.task.count({ where: { id, userId } }),
  note: (id, userId) => db.note.count({ where: { id, userId } }),
  noteFolder: (id, userId) => db.noteFolder.count({ where: { id, userId } }),
  goal: (id, userId) => db.goal.count({ where: { id, userId } }),
  habit: (id, userId) => db.habit.count({ where: { id, userId } }),
  event: (id, userId) => db.event.count({ where: { id, userId } }),
  expense: (id, userId) => db.expense.count({ where: { id, userId } }),
  expenseCategory: (id, userId) => db.expenseCategory.count({ where: { id, userId } }),
  budget: (id, userId) => db.budget.count({ where: { id, userId } }),
  tag: (id, userId) => db.tag.count({ where: { id, userId } }),
  journalEntry: (id, userId) => db.journalEntry.count({ where: { id, userId } }),
  document: (id, userId) => db.document.count({ where: { id, userId } }),
  recurrenceRule: (id, userId) => db.recurrenceRule.count({ where: { id, userId } }),
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
): Promise<void> {
  const count = await COUNTERS[model](id, userId);
  if (count === 0) throw notFound(LABELS[model]);
}

/** Same as requireOwned, but skips null/undefined so optional fields are ergonomic. */
export async function requireOwnedIfPresent(
  model: OwnedModel,
  id: string | null | undefined,
  userId: string,
): Promise<void> {
  if (id === null || id === undefined) return;
  await requireOwned(model, id, userId);
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
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;

  const found = await COUNT_MANY[model](unique, userId);
  if (found !== unique.length) throw notFound(LABELS[model]);
}

const COUNT_MANY: Record<OwnedModel, (ids: string[], userId: string) => Promise<number>> = {
  project: (ids, userId) => db.project.count({ where: { id: { in: ids }, userId } }),
  task: (ids, userId) => db.task.count({ where: { id: { in: ids }, userId } }),
  note: (ids, userId) => db.note.count({ where: { id: { in: ids }, userId } }),
  noteFolder: (ids, userId) => db.noteFolder.count({ where: { id: { in: ids }, userId } }),
  goal: (ids, userId) => db.goal.count({ where: { id: { in: ids }, userId } }),
  habit: (ids, userId) => db.habit.count({ where: { id: { in: ids }, userId } }),
  event: (ids, userId) => db.event.count({ where: { id: { in: ids }, userId } }),
  expense: (ids, userId) => db.expense.count({ where: { id: { in: ids }, userId } }),
  expenseCategory: (ids, userId) =>
    db.expenseCategory.count({ where: { id: { in: ids }, userId } }),
  budget: (ids, userId) => db.budget.count({ where: { id: { in: ids }, userId } }),
  tag: (ids, userId) => db.tag.count({ where: { id: { in: ids }, userId } }),
  journalEntry: (ids, userId) => db.journalEntry.count({ where: { id: { in: ids }, userId } }),
  document: (ids, userId) => db.document.count({ where: { id: { in: ids }, userId } }),
  recurrenceRule: (ids, userId) =>
    db.recurrenceRule.count({ where: { id: { in: ids }, userId } }),
};
