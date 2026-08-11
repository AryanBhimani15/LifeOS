import { db } from "@/lib/db";
import { requireAllOwned, requireOwned, requireOwnedIfPresent } from "@/lib/authz";
import { badRequest, notFound } from "@/lib/errors";
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from "@/lib/validation/task";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Task persistence.
 *
 * Every function takes `userId` as its first argument and applies it to the
 * top-level where clause. Foreign keys arriving from a request (projectId,
 * parentId, tagIds) are checked with the authz helpers BEFORE the write —
 * Prisma will happily attach another user's project through a nested write
 * otherwise. See src/lib/authz.ts.
 */

const TASK_INCLUDE = {
  project: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  subtasks: {
    select: { id: true, title: true, status: true, dueAt: true },
    orderBy: { boardOrder: "asc" },
  },
  _count: { select: { subtasks: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

/** Board ranks are spaced widely so ordinary drops need no rebalance. */
const RANK_GAP = 1024;
/**
 * Below this gap, repeated midpoint insertion is close to exhausting float
 * precision between two neighbours, so the column is renumbered. Without this
 * the ~50th drop between the same pair silently collides.
 */
const MIN_RANK_GAP = 0.0001;

async function validateForeignKeys(
  userId: string,
  input: { projectId?: string | null; parentId?: string | null; tagIds?: string[] },
) {
  await requireOwnedIfPresent("project", input.projectId, userId);
  await requireOwnedIfPresent("task", input.parentId, userId);
  if (input.tagIds?.length) await requireAllOwned("tag", input.tagIds, userId);
}

export async function listTasks(userId: string, query: TaskQuery) {
  const where: Prisma.TaskWhereInput = {
    userId,
    isTemplate: false,
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.priority ? { priority: { in: query.priority } } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.parentId
      ? { parentId: query.parentId }
      : query.includeSubtasks
        ? {}
        : { parentId: null }),
    ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.dueBefore || query.dueAfter
      ? {
          dueAt: {
            ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
            ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
          },
        }
      : {}),
  };

  const items = await db.task.findMany({
    where,
    include: TASK_INCLUDE,
    orderBy: [{ [query.sort]: query.dir }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > query.limit;
  return {
    items: hasMore ? items.slice(0, query.limit) : items,
    nextCursor: hasMore ? items[query.limit - 1]!.id : null,
  };
}

export async function getTask(userId: string, id: string) {
  const task = await db.task.findFirst({
    where: { id, userId },
    include: { ...TASK_INCLUDE, recurrence: true },
  });
  if (!task) throw notFound("Task");
  return task;
}

export async function createTask(userId: string, input: CreateTaskInput) {
  await validateForeignKeys(userId, input);

  if (input.parentId && input.recurrence) {
    throw badRequest("A subtask cannot have its own recurrence rule");
  }

  // Place new tasks at the end of their column.
  const last = await db.task.findFirst({
    where: { userId, status: input.status, parentId: input.parentId ?? null },
    orderBy: { boardOrder: "desc" },
    select: { boardOrder: true },
  });
  const boardOrder = (last?.boardOrder ?? 0) + RANK_GAP;

  return db.$transaction(async (tx) => {
    const rule = input.recurrence
      ? await tx.recurrenceRule.create({
          data: {
            userId,
            freq: input.recurrence.freq,
            interval: input.recurrence.interval,
            byWeekday: input.recurrence.byWeekday,
            byMonthday: input.recurrence.byMonthday ?? null,
            timezone: input.recurrence.timezone,
            atMinutes: input.recurrence.atMinutes,
            startsOn: new Date(`${input.recurrence.startsOn}T00:00:00Z`),
            until: input.recurrence.until
              ? new Date(`${input.recurrence.until}T00:00:00Z`)
              : null,
            count: input.recurrence.count ?? null,
          },
        })
      : null;

    const task = await tx.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        startAt: input.startAt ?? null,
        estimateMin: input.estimateMin ?? null,
        // Scalar FK assignment, never a nested connect of a client-supplied id.
        projectId: input.projectId ?? null,
        parentId: input.parentId ?? null,
        boardOrder,
        recurrenceRuleId: rule?.id ?? null,
        isTemplate: Boolean(rule),
        tags: input.tagIds.length
          ? { create: input.tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    if (task.projectId) {
      await tx.projectActivity.create({
        data: {
          projectId: task.projectId,
          userId,
          kind: "task.created",
          summary: `Task “${task.title}” added`,
          metadata: { taskId: task.id },
        },
      });
    }

    return task;
  });
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput) {
  await requireOwned("task", id, userId);
  await validateForeignKeys(userId, input);

  if (input.parentId === id) throw badRequest("A task cannot be its own parent");
  if (input.parentId) await assertNoCycle(userId, id, input.parentId);

  const existing = await db.task.findFirstOrThrow({
    where: { id, userId },
    select: { status: true, completedAt: true, projectId: true, title: true },
  });

  // completedAt is derived from status, never taken from the client, so the two
  // can never disagree.
  const statusChanged = input.status !== undefined && input.status !== existing.status;
  const completedAt =
    input.status === "DONE"
      ? (existing.completedAt ?? new Date())
      : input.status !== undefined
        ? null
        : undefined;

  return db.$transaction(async (tx) => {
    const task = await tx.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(input.estimateMin !== undefined ? { estimateMin: input.estimateMin } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.boardOrder !== undefined ? { boardOrder: input.boardOrder } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        ...(input.tagIds !== undefined
          ? { tags: { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: TASK_INCLUDE,
    });

    if (statusChanged && task.projectId) {
      await tx.projectActivity.create({
        data: {
          projectId: task.projectId,
          userId,
          kind: input.status === "DONE" ? "task.completed" : "task.status_changed",
          summary: `“${task.title}” moved to ${input.status?.toLowerCase().replace("_", " ")}`,
          metadata: { taskId: task.id, from: existing.status, to: input.status },
        },
      });
    }

    return task;
  });
}

/**
 * Walks the parent chain to reject a re-parent that would create a cycle.
 * A cycle makes subtask trees infinite and hangs any recursive render.
 */
const MAX_TASK_DEPTH = 50;

async function assertNoCycle(userId: string, taskId: string, newParentId: string) {
  let cursor: string | null = newParentId;
  for (let depth = 0; depth < MAX_TASK_DEPTH; depth++) {
    if (cursor === null) return; // reached a root without meeting ourselves
    if (cursor === taskId) throw badRequest("That would make the task its own ancestor");
    const parent: { parentId: string | null } | null = await db.task.findFirst({
      where: { id: cursor, userId },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
  // Running out of budget means the chain was NOT fully verified. Accepting the
  // update here would let a deep hierarchy smuggle a cycle past the check.
  throw badRequest(
    `Task hierarchy is deeper than ${MAX_TASK_DEPTH} levels — move it somewhere shallower.`,
  );
}

export async function deleteTask(userId: string, id: string) {
  await requireOwned("task", id, userId);
  // Subtasks cascade at the database level via Task.parentId onDelete: Cascade.
  await db.task.delete({ where: { id } });
}

/**
 * Places a task between two neighbours using fractional ranking, renumbering the
 * column when the available gap gets too small to split reliably.
 */
export async function reorderTask(
  userId: string,
  taskId: string,
  status: Parameters<typeof db.task.update>[0]["data"]["status"],
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
) {
  await requireOwned("task", taskId, userId);
  if (beforeId) await requireOwned("task", beforeId, userId);
  if (afterId) await requireOwned("task", afterId, userId);

  const neighbours = await db.task.findMany({
    where: { userId, id: { in: [beforeId, afterId].filter(Boolean) as string[] } },
    select: { id: true, boardOrder: true },
  });
  const before = neighbours.find((n) => n.id === beforeId)?.boardOrder;
  const after = neighbours.find((n) => n.id === afterId)?.boardOrder;

  let rank: number;
  if (before !== undefined && after !== undefined) rank = (before + after) / 2;
  else if (before !== undefined) rank = before + RANK_GAP;
  else if (after !== undefined) rank = after - RANK_GAP;
  else rank = RANK_GAP;

  const gapTooSmall =
    before !== undefined && after !== undefined && Math.abs(after - before) < MIN_RANK_GAP;

  const updated = await db.task.update({
    where: { id: taskId },
    data: { boardOrder: rank, status: status ?? undefined },
    include: TASK_INCLUDE,
  });

  if (gapTooSmall) await rebalanceColumn(userId, updated.status);
  return updated;
}

/** Renumbers a column to evenly spaced ranks, restoring room to insert. */
async function rebalanceColumn(userId: string, status: TaskWithRelations["status"]) {
  const column = await db.task.findMany({
    where: { userId, status, parentId: null, isTemplate: false },
    orderBy: { boardOrder: "asc" },
    select: { id: true },
  });

  await db.$transaction(
    column.map((task, index) =>
      db.task.update({ where: { id: task.id }, data: { boardOrder: (index + 1) * RANK_GAP } }),
    ),
  );
}
