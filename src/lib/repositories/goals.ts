import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { parseCalendarDate } from "@/lib/dates";
import { goalPercent, progressDetail, toMilli, type ProgressSources } from "@/lib/goals";
import type { GoalProgressMode, GoalStatus } from "@/generated/prisma/enums";
import type { CreateGoalInput, ListGoalsQuery, UpdateGoalInput } from "@/lib/validation/goal";

/**
 * Goals, milestones, and the links from a goal to work that already exists.
 *
 * Two rules shape this file.
 *
 * The first: a goal never owns tasks or habits, it only points at them. Linking
 * sets `Task.goalId`; unlinking clears it. The task keeps its own page, its own
 * board position and its own lifecycle, so there is exactly one Tasks feature
 * in this application and completing a task in any of the places it appears is
 * the same event.
 *
 * The second: the percentage is always computed, never stored. `goals.percent`
 * does not exist as a column, so it cannot drift from the milestones and tasks
 * it claims to summarise. `GoalProgress` rows are history — a record of what
 * the number *was* — and are only ever appended.
 */

/** Everything `goalPercent` needs, for both the list and the detail read. */
const PROGRESS_SELECT = {
  progressMode: true,
  manualPercent: true,
  currentMilli: true,
  targetMilli: true,
  unit: true,
  milestones: { select: { id: true, completedAt: true } },
  tasks: { select: { id: true, status: true } },
} as const;

type ProgressRow = {
  progressMode: GoalProgressMode;
  manualPercent: number;
  currentMilli: bigint;
  targetMilli: bigint | null;
  unit: string | null;
  milestones: { completedAt: Date | null }[];
  tasks: { status: string }[];
};

/** Collapses the relations into the flat shape the pure functions expect. */
function sources(row: ProgressRow): ProgressSources & { unit: string | null } {
  return {
    progressMode: row.progressMode,
    manualPercent: row.manualPercent,
    currentMilli: row.currentMilli,
    targetMilli: row.targetMilli,
    unit: row.unit,
    milestonesTotal: row.milestones.length,
    milestonesDone: row.milestones.filter((m) => m.completedAt !== null).length,
    tasksTotal: row.tasks.length,
    tasksDone: row.tasks.filter((t) => t.status === "DONE").length,
  };
}

/**
 * BigInt does not survive `JSON.stringify`, and these rows cross both the API
 * boundary and the server-to-client component boundary. Converting here — at
 * the one edge every read passes through — is what stops a route from throwing
 * "Do not know how to serialize a BigInt" months from now.
 */
function view<T extends ProgressRow>(row: T) {
  const s = sources(row);
  const { currentMilli, targetMilli, ...rest } = row;
  return {
    ...rest,
    currentValue: Number(currentMilli) / 1000,
    targetValue: targetMilli === null ? null : Number(targetMilli) / 1000,
    percent: goalPercent(s),
    detail: progressDetail(s),
    milestonesTotal: s.milestonesTotal,
    milestonesDone: s.milestonesDone,
    tasksTotal: s.tasksTotal,
    tasksDone: s.tasksDone,
  };
}

export type GoalSummary = Awaited<ReturnType<typeof listGoals>>[number];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const COMPLETED: GoalStatus[] = ["ACHIEVED"];

export async function listGoals(userId: string, query: ListGoalsQuery) {
  const rows = await db.goal.findMany({
    where: {
      userId,
      ...(query.tab === "active" ? { status: "ACTIVE" } : {}),
      ...(query.tab === "completed" ? { status: { in: COMPLETED } } : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      targetDate: true,
      startDate: true,
      icon: true,
      category: true,
      createdAt: true,
      project: { select: { id: true, name: true, color: true } },
      ...PROGRESS_SELECT,
    },
  });

  // The relations were selected only to count them; the counts are on `view`,
  // so the rows themselves are dropped rather than shipped to the browser.
  const goals = rows.map((row) => {
    const shaped = view(row);
    return {
      id: shaped.id,
      title: shaped.title,
      description: shaped.description,
      status: shaped.status,
      targetDate: shaped.targetDate,
      startDate: shaped.startDate,
      icon: shaped.icon,
      category: shaped.category,
      createdAt: shaped.createdAt,
      project: shaped.project,
      unit: shaped.unit,
      progressMode: shaped.progressMode,
      currentValue: shaped.currentValue,
      targetValue: shaped.targetValue,
      percent: shaped.percent,
      detail: shaped.detail,
      milestonesDone: shaped.milestonesDone,
      milestonesTotal: shaped.milestonesTotal,
      tasksDone: shaped.tasksDone,
      tasksTotal: shaped.tasksTotal,
    };
  });

  // Sorted in memory because `progress` is computed rather than stored, and
  // splitting the ordering between SQL and JS would make two sorts to reason
  // about instead of one.
  const byDeadline = (a: (typeof goals)[number], b: (typeof goals)[number]) => {
    if (!a.targetDate && !b.targetDate) return 0;
    if (!a.targetDate) return 1; // undated goals sink; they are never "next".
    if (!b.targetDate) return -1;
    return a.targetDate.getTime() - b.targetDate.getTime();
  };

  goals.sort((a, b) => {
    switch (query.sort) {
      case "deadline":
        return byDeadline(a, b);
      case "progress":
        return b.percent - a.percent;
      case "created":
        return b.createdAt.getTime() - a.createdAt.getTime();
      case "name":
        return a.title.localeCompare(b.title);
    }
  });

  return goals;
}

/**
 * The three numbers above the list.
 *
 * "This month" is the average percentage-point gain across active goals, taken
 * against each goal's last recorded percentage *before* this month began. A
 * goal created this month therefore counts its whole progress, which is what
 * someone means when they ask how this month went.
 */
export async function goalStats(userId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await db.goal.findMany({
    where: { userId },
    select: { id: true, status: true, ...PROGRESS_SELECT },
  });

  const baselines = await db.goalProgress.findMany({
    where: { goal: { userId }, recordedAt: { lt: monthStart } },
    select: { goalId: true, percent: true, recordedAt: true },
    orderBy: { recordedAt: "asc" },
  });
  const baseline = new Map<string, number>();
  for (const row of baselines) baseline.set(row.goalId, row.percent); // last write wins = latest

  const active = rows.filter((row) => row.status === "ACTIVE");
  const gains = active.map((row) => goalPercent(sources(row)) - (baseline.get(row.id) ?? 0));
  const monthProgress = gains.length
    ? Math.round(gains.reduce((sum, gain) => sum + gain, 0) / gains.length)
    : 0;

  return {
    active: active.length,
    completed: rows.filter((row) => COMPLETED.includes(row.status)).length,
    monthProgress,
    monthGoalCount: active.length,
  };
}

const DETAIL_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  targetDate: true,
  startDate: true,
  achievedAt: true,
  icon: true,
  category: true,
  createdAt: true,
  project: { select: { id: true, name: true, color: true } },
  progressMode: true,
  manualPercent: true,
  currentMilli: true,
  targetMilli: true,
  unit: true,
  milestones: {
    select: { id: true, title: true, targetDate: true, completedAt: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  },
  tasks: {
    select: { id: true, title: true, status: true, dueAt: true, dueHasTime: true },
    orderBy: { createdAt: "asc" },
  },
  habits: {
    select: { id: true, name: true, cadence: true, targetPerWeek: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  },
  progress: {
    select: { id: true, percent: true, note: true, recordedAt: true },
    orderBy: { recordedAt: "asc" },
    take: 60,
  },
} as const;

export type GoalDetail = Awaited<ReturnType<typeof getGoal>>;

export async function getGoal(userId: string, id: string) {
  const goal = await db.goal.findFirst({ where: { id, userId }, select: DETAIL_SELECT });
  if (!goal) throw notFound("Goal");

  const shaped = view(goal);

  // History is topped up on read.
  //
  // The percentage can move without any goal endpoint being called at all —
  // ticking a linked task off the board is the obvious case. Recording the
  // current value here means the trend reflects what actually happened rather
  // than only what happened to be done from this page.
  const last = goal.progress.at(-1);
  if (!last || last.percent !== shaped.percent) {
    const recorded = await db.goalProgress.create({
      data: { goalId: goal.id, percent: shaped.percent },
      select: { id: true, percent: true, note: true, recordedAt: true },
    });
    shaped.progress = [...goal.progress, recorded];
  }

  return shaped;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Shared mapping from validated input to column values. */
function goalData(input: Partial<CreateGoalInput & UpdateGoalInput>) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.category !== undefined ? { category: input.category || null } : {}),
    ...(input.icon !== undefined ? { icon: input.icon ?? null } : {}),
    ...(input.unit !== undefined ? { unit: input.unit || null } : {}),
    ...(input.progressMode !== undefined ? { progressMode: input.progressMode } : {}),
    ...(input.manualPercent !== undefined ? { manualPercent: input.manualPercent } : {}),
    ...(input.targetValue !== undefined
      ? { targetMilli: input.targetValue === null ? null : toMilli(input.targetValue) }
      : {}),
    ...(input.currentValue !== undefined
      ? { currentMilli: toMilli(input.currentValue ?? 0) }
      : {}),
    ...(input.targetDate !== undefined
      ? { targetDate: parseCalendarDate(input.targetDate) }
      : {}),
    ...(input.startDate !== undefined ? { startDate: parseCalendarDate(input.startDate) } : {}),
  };
}

async function assertProjectOwned(userId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw notFound("Project");
}

export async function createGoal(userId: string, input: CreateGoalInput) {
  await assertProjectOwned(userId, input.projectId);

  const created = await db.goal.create({
    data: {
      userId,
      ...goalData(input),
      title: input.title,
      projectId: input.projectId ?? null,
    },
    select: { id: true, title: true },
  });

  // Links are applied with the ownership filter in the WHERE clause, so ids
  // belonging to someone else simply match nothing. They are attached after the
  // goal exists rather than nested in the create, because a task pointed at a
  // goal that failed to save would be worse than a goal with no links.
  if (input.taskIds?.length) {
    await db.task.updateMany({
      where: { id: { in: input.taskIds }, userId },
      data: { goalId: created.id },
    });
  }
  if (input.habitIds?.length) {
    await db.habit.updateMany({
      where: { id: { in: input.habitIds }, userId },
      data: { goalId: created.id },
    });
  }

  const goal = await db.goal.findUniqueOrThrow({
    where: { id: created.id },
    select: PROGRESS_SELECT,
  });

  // The opening point of the trend, so a goal that starts at 40% does not look
  // like it appeared from nowhere later.
  await db.goalProgress.create({
    data: { goalId: created.id, percent: goalPercent(sources(goal)), note: "Created" },
  });

  return { id: created.id, title: created.title };
}

export async function updateGoal(userId: string, id: string, patch: UpdateGoalInput) {
  const existing = await db.goal.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound("Goal");
  await assertProjectOwned(userId, patch.projectId);

  const status = patch.status;
  const updated = await db.goal.update({
    where: { id },
    data: {
      ...goalData(patch),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId ?? null } : {}),
      ...(status ? { status } : {}),
      // Achieving a goal stamps the date; un-achieving it clears the stamp
      // rather than leaving a completion date on a goal that is not complete.
      ...(status === "ACHIEVED" ? { achievedAt: new Date() } : {}),
      ...(status && status !== "ACHIEVED" ? { achievedAt: null } : {}),
    },
    select: { id: true, title: true, ...PROGRESS_SELECT },
  });

  await recordIfChanged(updated.id, goalPercent(sources(updated)));
  return { id: updated.id, title: updated.title };
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  // Milestones and history cascade; linked tasks and habits do not. Deleting a
  // goal must never delete the work — `Task.goalId` is set null by the schema,
  // and the task stays exactly where its owner left it.
  const { count } = await db.goal.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Goal");
}

async function recordIfChanged(goalId: string, percent: number, note?: string) {
  const last = await db.goalProgress.findFirst({
    where: { goalId },
    orderBy: { recordedAt: "desc" },
    select: { percent: true },
  });
  if (last?.percent === percent) return;
  await db.goalProgress.create({ data: { goalId, percent, note: note ?? null } });
}

/** Recomputes and records after anything that could move the number. */
async function syncProgress(goalId: string, note?: string) {
  const goal = await db.goal.findUnique({ where: { id: goalId }, select: PROGRESS_SELECT });
  if (!goal) return;
  await recordIfChanged(goalId, goalPercent(sources(goal)), note);
}

async function ownedGoal(userId: string, goalId: string) {
  const goal = await db.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw notFound("Goal");
  return goal;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function addMilestone(
  userId: string,
  goalId: string,
  input: { title: string; targetDate?: string | null },
) {
  await ownedGoal(userId, goalId);

  const last = await db.milestone.findFirst({
    where: { goalId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const milestone = await db.milestone.create({
    data: {
      goalId,
      title: input.title,
      targetDate: parseCalendarDate(input.targetDate),
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
    select: { id: true, title: true, targetDate: true, completedAt: true, sortOrder: true },
  });

  await syncProgress(goalId);
  return milestone;
}

/** Milestones are reached through their goal, so ownership is checked once. */
async function ownedMilestone(userId: string, id: string) {
  const milestone = await db.milestone.findFirst({
    where: { id, goal: { userId } },
    select: { id: true, goalId: true, completedAt: true },
  });
  if (!milestone || !milestone.goalId) throw notFound("Milestone");
  return milestone as { id: string; goalId: string; completedAt: Date | null };
}

export async function updateMilestone(
  userId: string,
  id: string,
  patch: { title?: string; targetDate?: string | null; completed?: boolean },
) {
  const milestone = await ownedMilestone(userId, id);

  const updated = await db.milestone.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.targetDate !== undefined
        ? { targetDate: parseCalendarDate(patch.targetDate) }
        : {}),
      ...(patch.completed !== undefined
        ? { completedAt: patch.completed ? (milestone.completedAt ?? new Date()) : null }
        : {}),
    },
    select: { id: true, title: true, targetDate: true, completedAt: true, sortOrder: true },
  });

  await syncProgress(milestone.goalId);
  return updated;
}

export async function deleteMilestone(userId: string, id: string): Promise<void> {
  const milestone = await ownedMilestone(userId, id);
  await db.milestone.delete({ where: { id } });
  await syncProgress(milestone.goalId);
}

/**
 * Reorders by rewriting every position from the submitted order.
 *
 * The whole list arrives, so there is no gap-splitting arithmetic to run out of
 * precision, and an id belonging to someone else simply is not among the rows
 * the update touches.
 */
export async function reorderMilestones(userId: string, goalId: string, ids: string[]) {
  await ownedGoal(userId, goalId);

  const owned = await db.milestone.findMany({
    where: { goalId, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((row) => row.id));
  const ordered = ids.filter((id) => ownedIds.has(id));
  if (ordered.length !== ids.length) throw badRequest("That milestone is not on this goal.");

  await db.$transaction(
    ordered.map((id, index) =>
      db.milestone.update({ where: { id }, data: { sortOrder: index + 1 } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Links to existing work
// ---------------------------------------------------------------------------

export async function linkTask(userId: string, goalId: string, taskId: string) {
  await ownedGoal(userId, goalId);
  const { count } = await db.task.updateMany({
    where: { id: taskId, userId },
    data: { goalId },
  });
  if (count === 0) throw notFound("Task");
  await syncProgress(goalId);
}

export async function unlinkTask(userId: string, goalId: string, taskId: string) {
  await ownedGoal(userId, goalId);
  const { count } = await db.task.updateMany({
    where: { id: taskId, userId, goalId },
    data: { goalId: null },
  });
  if (count === 0) throw notFound("Task");
  await syncProgress(goalId);
}

export async function linkHabit(userId: string, goalId: string, habitId: string) {
  await ownedGoal(userId, goalId);
  const { count } = await db.habit.updateMany({ where: { id: habitId, userId }, data: { goalId } });
  if (count === 0) throw notFound("Habit");
}

export async function unlinkHabit(userId: string, goalId: string, habitId: string) {
  await ownedGoal(userId, goalId);
  const { count } = await db.habit.updateMany({
    where: { id: habitId, userId, goalId },
    data: { goalId: null },
  });
  if (count === 0) throw notFound("Habit");
}

/** Candidates for the "link existing work" pickers: unlinked, or already ours. */
export async function linkableTasks(userId: string, goalId: string) {
  return db.task.findMany({
    where: { userId, isTemplate: false, parentId: null, OR: [{ goalId: null }, { goalId }] },
    select: { id: true, title: true, status: true, dueAt: true, goalId: true },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function linkableHabits(userId: string, goalId: string) {
  return db.habit.findMany({
    where: { userId, archivedAt: null, OR: [{ goalId: null }, { goalId }] },
    select: { id: true, name: true, goalId: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

/** The compact goal card on Home: the nearest deadline that is still open. */
export async function headlineGoals(userId: string, limit = 3) {
  const rows = await db.goal.findMany({
    where: { userId, status: "ACTIVE" },
    select: { id: true, title: true, targetDate: true, icon: true, ...PROGRESS_SELECT },
    orderBy: [{ targetDate: "asc" }],
    take: limit,
  });
  return rows.map((row) => {
    const shaped = view(row);
    return {
      id: row.id,
      title: row.title,
      targetDate: row.targetDate,
      icon: row.icon,
      percent: shaped.percent,
      detail: shaped.detail,
    };
  });
}
