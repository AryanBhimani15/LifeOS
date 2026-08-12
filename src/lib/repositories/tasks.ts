import { db } from "@/lib/db";
import { requireAllOwned, requireOwned, requireOwnedIfPresent, type DbClient } from "@/lib/authz";
import { badRequest, notFound } from "@/lib/errors";
import { parseCapture } from "@/lib/nlp/parse-capture";
import { tidyTitle } from "@/lib/validation/capture";
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
  client: DbClient = db,
) {
  await requireOwnedIfPresent("project", input.projectId, userId, client);
  await requireOwnedIfPresent("task", input.parentId, userId, client);
  if (input.tagIds?.length) await requireAllOwned("tag", input.tagIds, userId, client);
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
  return db.$transaction((tx) => createTaskInTransaction(tx, userId, input));
}

/**
 * The canonical write, usable by larger atomic workflows (notably AI plans).
 * Keeping this inside the caller's transaction preserves exactly-once plan
 * execution while giving every task the same ordering and project activity.
 */
export async function createTaskInTransaction(client: DbClient, userId: string, input: CreateTaskInput) {
  await validateForeignKeys(userId, input, client);

  if (input.parentId && input.recurrence) {
    throw badRequest("A subtask cannot have its own recurrence rule");
  }

  // Place new tasks at the end of their column.
  const last = await client.task.findFirst({
    where: { userId, status: input.status, parentId: input.parentId ?? null },
    orderBy: { boardOrder: "desc" },
    select: { boardOrder: true },
  });
  const boardOrder = (last?.boardOrder ?? 0) + RANK_GAP;

  const rule = input.recurrence
    ? await client.recurrenceRule.create({
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

  const task = await client.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        dueHasTime: input.dueAt ? (input.dueHasTime ?? false) : false,
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
      await client.projectActivity.create({
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
}

/**
 * The one way a task gets created from something a person typed or said.
 *
 * Everything that captures a task goes through here: the Add Task field, the
 * quick capture on Today, voice capture, and the ⌘K bar. Before this existed
 * there were three creation paths — `createTask`, a bare `db.task.create` in
 * the capture repository, and another inside the AI executor — which meant
 * board ordering, project activity and date parsing all behaved differently
 * depending on where you happened to be standing when you typed.
 *
 * It is a thin layer on `createTask`, not a replacement: parse the sentence,
 * let anything the user picked explicitly win, then hand over.
 */
export interface CaptureTaskInput {
  /** Raw text. Dates and times are extracted from it, never invented. */
  text: string;
  /**
   * From a date chip or picker. Overrides whatever the text said, because a
   * deliberate tap is a stronger signal than a parsed word — and `null`
   * explicitly means "no date", so it is distinguishable from "not specified".
   */
  dueAt?: Date | null;
  dueHasTime?: boolean;
  note?: string | null;
  remindAt?: Date | null;
  projectId?: string | null;
  parentId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export interface CaptureTaskResult {
  task: TaskWithRelations;
  /** The phrase that became the date, so the UI can show its working. */
  matchedText: string | null;
}

export async function captureTask(
  userId: string,
  input: CaptureTaskInput,
  context: { timeZone: string; weekStartsOn?: number },
): Promise<CaptureTaskResult> {
  const parsed = parseCapture(input.text, {
    timeZone: context.timeZone,
    weekStartsOn: context.weekStartsOn,
  });

  const explicitDate = input.dueAt !== undefined;
  const dueAt = explicitDate ? input.dueAt : parsed.dueAt;
  const dueHasTime = explicitDate ? (input.dueHasTime ?? false) : parsed.dueHasTime;

  const task = await createTask(userId, {
    // Filler and capitalisation are tidied here so every entry point gets it.
    // Speech in particular arrives as "remind me to call dad", and a task list
    // full of "remind me to…" is a list nobody can scan.
    title: tidyTitle(parsed.title).slice(0, 200),
    description: input.note?.trim() || null,
    status: "TODO",
    // Nothing is inferred about importance, but a choice in the capture
    // sheet is preserved instead of being silently reset to medium.
    priority: input.priority ?? "MEDIUM",
    dueAt: dueAt ?? null,
    dueHasTime,
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    tagIds: [],
  });

  if (input.remindAt) {
    await db.reminder.create({
      data: { userId, taskId: task.id, remindAt: input.remindAt },
    });
  }

  return { task, matchedText: explicitDate ? null : parsed.matchedText };
}

/**
 * Everything the detail view renders, in one query.
 *
 * `events` and `reminders` come back as arrays because a task can have several,
 * but the view shows the first of each — it is a detail panel, not a manager.
 * Both are selected rather than counted so the panel can decide to draw nothing
 * at all when they are empty, which is the whole design of that screen.
 */
export async function getTaskDetail(userId: string, id: string) {
  const task = await db.task.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      dueAt: true,
      dueHasTime: true,
      project: { select: { name: true } },
      subtasks: {
        select: { id: true, title: true, status: true },
        orderBy: { boardOrder: "asc" },
      },
      reminders: {
        select: { id: true, remindAt: true },
        orderBy: { remindAt: "asc" },
        take: 1,
      },
      documents: {
        select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: { id: true, title: true, startAt: true, endAt: true },
        orderBy: { startAt: "asc" },
        take: 1,
      },
    },
  });
  if (!task) throw notFound("Task");
  return task;
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
        ...(input.dueAt !== undefined
          ? { dueAt: input.dueAt, dueHasTime: input.dueAt ? (input.dueHasTime ?? false) : false }
          : input.dueHasTime !== undefined
            ? { dueHasTime: input.dueHasTime }
            : {}),
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
