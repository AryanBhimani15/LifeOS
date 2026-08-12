import { db } from "@/lib/db";
import { addDays, endOfDayInZone, startOfDayInZone, todayInZone } from "@/lib/dates";
import { currentStreak } from "@/lib/habits";
import { sumMinor } from "@/lib/money";

/**
 * Data for the Today view.
 *
 * The dashboard is meant to prioritise, not to list rows, so ranking happens
 * here with an explicit, checkable rule rather than being left to whatever
 * order the database returns.
 */

const PRIORITY_WEIGHT: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface NowItem {
  id: string;
  title: string;
  /** The reason this ranks where it does, shown to the user. */
  why: string;
  due: string;
  tone: "blue" | "yellow" | "peach";
  overdue: boolean;
}

export async function getTodayData(userId: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, currency: true, weekStartsOn: true },
  });
  const zone = settings?.timezone ?? "UTC";
  const currency = settings?.currency ?? "USD";
  const weekStartsOn = settings?.weekStartsOn ?? 1;

  const now = new Date();
  const dayStart = startOfDayInZone(now, zone);
  const dayEnd = endOfDayInZone(now, zone);
  const monthStart = startOfDayInZone(addDays(now, -30), zone);

  const [openTasks, events, habits, goals, expenses, recentNotes] = await Promise.all([
    db.task.findMany({
      where: {
        userId,
        isTemplate: false,
        status: { notIn: ["DONE", "CANCELLED"] },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        status: true,
        project: { select: { name: true } },
        _count: { select: { subtasks: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 100,
    }),

    db.event.findMany({
      where: { userId, startAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, title: true, startAt: true, endAt: true, allDay: true },
      orderBy: { startAt: "asc" },
    }),

    db.habit.findMany({
      where: { userId, archivedAt: null },
      select: {
        id: true,
        name: true,
        cadence: true,
        byWeekday: true,
        targetPerWeek: true,
        startedOn: true,
        completions: {
          where: { completedOn: { gte: addDays(dayStart, -400) } },
          select: { completedOn: true },
          orderBy: { completedOn: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),

    db.goal.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        milestones: { select: { completedAt: true } },
        progress: { select: { percent: true }, orderBy: { recordedAt: "desc" }, take: 1 },
      },
      take: 6,
    }),

    db.expense.findMany({
      where: { userId, kind: "EXPENSE", spentOn: { gte: monthStart } },
      select: { amountMinor: true, spentOn: true },
      orderBy: { spentOn: "asc" },
    }),

    db.note.findMany({
      where: { userId },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
  ]);

  const today = todayInZone(zone, now);

  return {
    zone,
    currency,
    now: rankNow(openTasks, now, dayEnd),
    events,
    // Streaks come from the same rules the Habits page uses. Two definitions of
    // "streak" in one product means two different numbers for the same habit on
    // two different screens, which is the kind of thing nobody reports as a bug
    // and everybody stops trusting.
    habits: habits.map((h) => {
      const completed = new Set(h.completions.map((c) => c.completedOn.toISOString().slice(0, 10)));
      const streak = currentStreak(
        {
          cadence: h.cadence,
          byWeekday: h.byWeekday,
          targetPerWeek: h.targetPerWeek,
          startedOn: h.startedOn ? h.startedOn.toISOString().slice(0, 10) : null,
        },
        completed,
        today,
        weekStartsOn,
      );
      return {
        id: h.id,
        name: h.name,
        doneToday: completed.has(today),
        streak: streak.count,
        streakUnit: streak.unit,
      };
    }),
    goals: goals.map((g) => {
      const total = g.milestones.length;
      const done = g.milestones.filter((m) => m.completedAt).length;
      // Prefer an explicitly recorded percentage; fall back to milestone ratio.
      const percent =
        g.progress[0]?.percent ?? (total > 0 ? Math.round((done / total) * 100) : 0);
      return { id: g.id, title: g.title, percent };
    }),
    spend: {
      totalMinor: sumMinor(expenses.map((e) => e.amountMinor)),
      series: expenses.map((e) => e.amountMinor),
    },
    recentNotes,
    counts: {
      overdue: openTasks.filter((t) => t.dueAt && t.dueAt < now).length,
      dueToday: openTasks.filter((t) => t.dueAt && t.dueAt >= now && t.dueAt <= dayEnd).length,
      open: openTasks.length,
    },
  };
}

/**
 * Ranks the handful of things that actually matter right now.
 *
 * Score = urgency + priority + a nudge for blocked work. Overdue always
 * outranks upcoming, because a missed deadline is a fact rather than a risk.
 */
function rankNow(
  tasks: {
    id: string;
    title: string;
    dueAt: Date | null;
    priority: string;
    status: string;
    project: { name: string } | null;
    _count: { subtasks: number };
  }[],
  now: Date,
  dayEnd: Date,
): NowItem[] {
  const scored = tasks.map((task) => {
    const overdue = Boolean(task.dueAt && task.dueAt < now);
    const dueToday = Boolean(task.dueAt && task.dueAt >= now && task.dueAt <= dayEnd);
    const hoursLeft = task.dueAt ? (task.dueAt.getTime() - now.getTime()) / 3_600_000 : Infinity;

    let score = PRIORITY_WEIGHT[task.priority] ?? 2;
    if (overdue) score += 10;
    else if (dueToday) score += 6;
    else if (hoursLeft < 72) score += 3;
    if (task.status === "BLOCKED") score += 2;

    const why = overdue
      ? `overdue · ${task.priority.toLowerCase()} priority`
      : dueToday
        ? `due in ${Math.max(1, Math.round(hoursLeft))}h${task.project ? ` · ${task.project.name}` : ""}`
        : task.status === "BLOCKED"
          ? `blocked${task.project ? ` · ${task.project.name}` : ""}`
          : task._count.subtasks > 0
            ? `${task._count.subtasks} subtasks${task.project ? ` · ${task.project.name}` : ""}`
            : (task.project?.name ?? `${task.priority.toLowerCase()} priority`);

    return {
      id: task.id,
      title: task.title,
      why,
      due: task.dueAt
        ? overdue
          ? "Overdue"
          : dueToday
            ? formatTime(task.dueAt)
            : task.dueAt.toISOString().slice(0, 10)
        : "No date",
      tone: (overdue ? "peach" : dueToday ? "yellow" : "blue") as NowItem["tone"],
      overdue,
      score,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      why: item.why,
      due: item.due,
      tone: item.tone,
      overdue: item.overdue,
    }));
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Counts consecutive days ending today (or yesterday, if today is not done yet). */
/* The local `streakLength` that used to live here counted consecutive days and
   nothing else, which is only correct for a daily habit — a Mon/Wed/Fri habit
   lost its streak every Saturday. It has been replaced by `currentStreak` in
   src/lib/habits.ts, which knows what each habit was actually asked to do. */
