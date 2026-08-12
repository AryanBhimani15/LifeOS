import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { parseCalendarDate, todayInZone } from "@/lib/dates";
import {
  addDaysIso,
  bestStreak,
  cadenceLabel,
  completionRate,
  currentStreak,
  dayState,
  isAvailableOn,
  isExpectedOn,
  parseReminder,
  type DayState,
  type Schedule,
} from "@/lib/habits";
import type { CreateHabitInput, ListHabitsQuery, UpdateHabitInput } from "@/lib/validation/habit";

/**
 * Habits, and the history that gives them meaning.
 *
 * The only stored fact is "this habit was done on this date" — one row per
 * habit per day, with a unique constraint that makes ticking twice a no-op.
 * Streaks, completion rates and the tracker grid are all computed from those
 * rows by the pure functions in src/lib/habits.ts.
 *
 * Nothing here stores a streak count. A stored counter would have to be
 * corrected every time a day is un-ticked, a schedule is changed, or a habit is
 * back-filled, and the first one that got missed would leave the number lying
 * about someone's life for as long as they kept using the app.
 */

/** How much history to load. Two years is well past any streak worth drawing. */
const HISTORY_DAYS = 730;

const HABIT_SELECT = {
  id: true,
  name: true,
  description: true,
  cadence: true,
  category: true,
  icon: true,
  color: true,
  byWeekday: true,
  targetPerWeek: true,
  reminderMinutes: true,
  startedOn: true,
  archivedAt: true,
  createdAt: true,
  goal: { select: { id: true, title: true } },
} as const;

type HabitRow = {
  cadence: Schedule["cadence"];
  byWeekday: number[];
  targetPerWeek: number;
  startedOn: Date | null;
};

function scheduleOf(habit: HabitRow): Schedule {
  return {
    cadence: habit.cadence,
    byWeekday: habit.byWeekday,
    targetPerWeek: habit.targetPerWeek,
    startedOn: habit.startedOn ? habit.startedOn.toISOString().slice(0, 10) : null,
  };
}

async function context(userId: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });
  const zone = settings?.timezone ?? "UTC";
  return { zone, weekStartsOn: settings?.weekStartsOn ?? 1, today: todayInZone(zone) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type HabitSummary = Awaited<ReturnType<typeof listHabits>>["habits"][number];

export async function listHabits(userId: string, query: ListHabitsQuery) {
  const { today, weekStartsOn } = await context(userId);
  const since = parseCalendarDate(addDaysIso(today, -HISTORY_DAYS))!;

  const rows = await db.habit.findMany({
    where: {
      userId,
      archivedAt: null,
      ...(query.category !== "ALL" ? { category: query.category } : {}),
    },
    select: {
      ...HABIT_SELECT,
      completions: {
        where: { completedOn: { gte: since } },
        select: { completedOn: true },
      },
    },
    orderBy: [{ reminderMinutes: "asc" }, { createdAt: "asc" }],
  });

  const habits = rows.map((row) => {
    const schedule = scheduleOf(row);
    const completed = new Set(row.completions.map((c) => c.completedOn.toISOString().slice(0, 10)));

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      icon: row.icon,
      color: row.color,
      cadence: row.cadence,
      cadenceText: cadenceLabel(schedule),
      byWeekday: row.byWeekday,
      targetPerWeek: row.targetPerWeek,
      reminderMinutes: row.reminderMinutes,
      goal: row.goal,
      doneToday: completed.has(today),
      /** Whether today is a day this habit even asks for. */
      dueToday: isAvailableOn(schedule, today),
      expectedToday: isExpectedOn(schedule, today),
      streak: currentStreak(schedule, completed, today, weekStartsOn),
      best: bestStreak(schedule, completed, today, weekStartsOn),
      rate: completionRate(schedule, completed, addDaysIso(today, -29), today, weekStartsOn),
      /** Completions this week, which is what a weekly-target habit is judged on. */
      weekDone: countInWeek(completed, today, weekStartsOn),
    };
  });

  return { habits, today, weekStartsOn };
}

function countInWeek(completed: ReadonlySet<string>, today: string, weekStartsOn: number): number {
  const shift = (new Date(`${today}T00:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDaysIso(today, -shift);
  let hits = 0;
  for (let day = 0; day < 7; day += 1) {
    if (completed.has(addDaysIso(start, day))) hits += 1;
  }
  return hits;
}

/**
 * The three numbers above the list.
 *
 * "Current streak" is the best streak running right now across all habits, and
 * "best" the longest ever — both carry the habit's name, because a number with
 * nothing attached to it is trivia rather than encouragement.
 */
export async function habitStats(userId: string) {
  const { habits } = await listHabits(userId, { category: "ALL", view: "today" });

  const due = habits.filter((habit) => habit.dueToday);
  const best = habits.reduce<(typeof habits)[number] | null>(
    (top, habit) => (top === null || habit.best.count > top.best.count ? habit : top),
    null,
  );
  const running = habits.reduce<(typeof habits)[number] | null>(
    (top, habit) => (top === null || habit.streak.count > top.streak.count ? habit : top),
    null,
  );

  return {
    total: habits.length,
    doneToday: due.filter((habit) => habit.doneToday).length,
    dueToday: due.length,
    current: running && running.streak.count > 0
      ? { name: running.name, ...running.streak }
      : null,
    best: best && best.best.count > 0 ? { name: best.name, ...best.best } : null,
  };
}

export type HabitDetail = Awaited<ReturnType<typeof getHabit>>;

export async function getHabit(userId: string, id: string) {
  const { today, weekStartsOn } = await context(userId);
  const since = parseCalendarDate(addDaysIso(today, -HISTORY_DAYS))!;

  const habit = await db.habit.findFirst({
    where: { id, userId },
    select: {
      ...HABIT_SELECT,
      completions: {
        where: { completedOn: { gte: since } },
        select: { completedOn: true, note: true },
        orderBy: { completedOn: "desc" },
      },
    },
  });
  if (!habit) throw notFound("Habit");

  const schedule = scheduleOf(habit);
  const completed = new Set(habit.completions.map((c) => c.completedOn.toISOString().slice(0, 10)));

  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    category: habit.category,
    icon: habit.icon,
    color: habit.color,
    cadence: habit.cadence,
    cadenceText: cadenceLabel(schedule),
    byWeekday: habit.byWeekday,
    targetPerWeek: habit.targetPerWeek,
    reminderMinutes: habit.reminderMinutes,
    startedOn: habit.startedOn,
    goal: habit.goal,
    createdAt: habit.createdAt,
    doneToday: completed.has(today),
    dueToday: isAvailableOn(schedule, today),
    streak: currentStreak(schedule, completed, today, weekStartsOn),
    best: bestStreak(schedule, completed, today, weekStartsOn),
    rate30: completionRate(schedule, completed, addDaysIso(today, -29), today, weekStartsOn),
    rateAll: completionRate(
      schedule,
      completed,
      habit.startedOn?.toISOString().slice(0, 10) ?? addDaysIso(today, -HISTORY_DAYS),
      today,
      weekStartsOn,
    ),
    totalCompletions: completed.size,
    /** The last 26 weeks, for the history chart. */
    history: buildDays(schedule, completed, today, 182),
    today,
  };
}

interface GridDay {
  iso: string;
  state: DayState;
}

function buildDays(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  today: string,
  days: number,
): GridDay[] {
  const out: GridDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const iso = addDaysIso(today, -offset);
    out.push({ iso, state: dayState(schedule, iso, completed, today) });
  }
  return out;
}

/**
 * The tracker grid: habits down, days across.
 *
 * Every cell is one of four things — done, missed, not scheduled, or still to
 * come — because a grid that only knows "ticked" and "not ticked" tells someone
 * they failed on days nothing was ever asked of them.
 */
export async function habitGrid(userId: string, days = 14) {
  const { today, weekStartsOn } = await context(userId);
  const since = parseCalendarDate(addDaysIso(today, -(days + 7)))!;

  // The grid runs to the end of the current week rather than stopping dead on
  // today, so the week you are in is visible as a whole — and so "still to
  // come" is a state the legend can honestly describe.
  const intoWeek = (new Date(`${today}T00:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7;
  const lookahead = 6 - intoWeek;

  const rows = await db.habit.findMany({
    where: { userId, archivedAt: null },
    select: {
      id: true,
      name: true,
      icon: true,
      cadence: true,
      byWeekday: true,
      targetPerWeek: true,
      startedOn: true,
      completions: {
        where: { completedOn: { gte: since } },
        select: { completedOn: true },
      },
    },
    orderBy: [{ reminderMinutes: "asc" }, { createdAt: "asc" }],
  });

  const dates: string[] = [];
  for (let offset = days - 1; offset >= -lookahead; offset -= 1) {
    dates.push(addDaysIso(today, -offset));
  }

  return {
    dates,
    today,
    weekStartsOn,
    rows: rows.map((row) => {
      const schedule = scheduleOf(row);
      const completed = new Set(
        row.completions.map((c) => c.completedOn.toISOString().slice(0, 10)),
      );
      return {
        id: row.id,
        name: row.name,
        icon: row.icon,
        cells: dates.map((iso) => dayState(schedule, iso, completed, today)),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function habitData(input: Partial<CreateHabitInput & UpdateHabitInput>) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.icon !== undefined ? { icon: input.icon ?? null } : {}),
    ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
    ...(input.byWeekday !== undefined ? { byWeekday: input.byWeekday } : {}),
    ...(input.targetPerWeek !== undefined ? { targetPerWeek: input.targetPerWeek } : {}),
    ...(input.reminder !== undefined ? { reminderMinutes: parseReminder(input.reminder) } : {}),
    ...(input.startedOn !== undefined ? { startedOn: parseCalendarDate(input.startedOn) } : {}),
  };
}

/**
 * Keeps `targetPerWeek` honest against the cadence.
 *
 * It is the denominator for a times-per-week habit and pure decoration for the
 * others, so leaving a stale 3 on a habit switched to daily would make a later
 * switch back silently wrong.
 */
function normalisedTarget(
  cadence: Schedule["cadence"] | undefined,
  byWeekday: number[] | undefined,
  target: number | undefined,
) {
  if (cadence === "DAILY") return { targetPerWeek: 7 };
  if (cadence === "SPECIFIC_DAYS") return { targetPerWeek: Math.max(1, byWeekday?.length ?? 1) };
  if (cadence === "TIMES_PER_WEEK") return { targetPerWeek: target ?? 3 };
  return {};
}

async function assertGoalOwned(userId: string, goalId: string | null | undefined) {
  if (!goalId) return;
  const goal = await db.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw notFound("Goal");
}

export async function createHabit(userId: string, input: CreateHabitInput) {
  await assertGoalOwned(userId, input.goalId);
  const { today } = await context(userId);

  return db.habit.create({
    data: {
      userId,
      ...habitData(input),
      ...normalisedTarget(input.cadence, input.byWeekday, input.targetPerWeek),
      name: input.name,
      goalId: input.goalId ?? null,
      // A habit with no start date began today — in the user's own day, not
      // UTC's. Backdating it would invent a stretch of missed days the person
      // never agreed to.
      startedOn: parseCalendarDate(input.startedOn ?? today),
    },
    select: { id: true, name: true },
  });
}

export async function updateHabit(userId: string, id: string, patch: UpdateHabitInput) {
  const existing = await db.habit.findFirst({
    where: { id, userId },
    select: { id: true, cadence: true, byWeekday: true, targetPerWeek: true },
  });
  if (!existing) throw notFound("Habit");
  await assertGoalOwned(userId, patch.goalId);

  const cadence = patch.cadence ?? existing.cadence;
  const byWeekday = patch.byWeekday ?? existing.byWeekday;

  return db.habit.update({
    where: { id },
    data: {
      ...habitData(patch),
      ...normalisedTarget(cadence, byWeekday, patch.targetPerWeek ?? existing.targetPerWeek),
      ...(patch.goalId !== undefined ? { goalId: patch.goalId ?? null } : {}),
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date() : null }
        : {}),
    },
    select: { id: true, name: true },
  });
}

/**
 * Deleting removes the history with it, which is the point: someone deleting a
 * habit is saying it was never part of their life, not archiving a record.
 * Archiving (`archived: true`) is the option that keeps the history.
 */
export async function deleteHabit(userId: string, id: string): Promise<void> {
  const { count } = await db.habit.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Habit");
}

/**
 * Marks a day done or not done.
 *
 * Idempotent in both directions: ticking a day that is already ticked is a
 * no-op rather than a duplicate row or an error, which is what makes a
 * double-tap on a phone harmless.
 */
export async function setCompletion(
  userId: string,
  habitId: string,
  done: boolean,
  on?: string,
): Promise<{ done: boolean; on: string }> {
  const habit = await db.habit.findFirst({
    where: { id: habitId, userId },
    select: { id: true },
  });
  if (!habit) throw notFound("Habit");

  const { today } = await context(userId);
  const iso = on ?? today;

  // A habit cannot be completed in advance. Without this, one tap on a future
  // cell would manufacture a streak that never happened.
  if (iso > today) throw badRequest("You cannot tick off a day that has not happened yet.");

  const completedOn = parseCalendarDate(iso)!;

  if (done) {
    await db.habitCompletion.upsert({
      where: { habitId_completedOn: { habitId, completedOn } },
      create: { habitId, userId, completedOn },
      update: {},
    });
  } else {
    await db.habitCompletion.deleteMany({ where: { habitId, completedOn } });
  }

  return { done, on: iso };
}

/** Today's habits for the Home screen: what is due, and what is already done. */
export async function todayHabits(userId: string, limit = 12) {
  const { habits, today } = await listHabits(userId, { category: "ALL", view: "today" });
  return {
    today,
    habits: habits.filter((habit) => habit.dueToday).slice(0, limit),
  };
}
