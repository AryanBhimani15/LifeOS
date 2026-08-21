import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { recomputeRelativeEventReminders } from "@/lib/repositories/reminders";
import {
  endOfDayInZone,
  parseCalendarDate,
  startOfCalendarDayInZone,
  todayInZone,
} from "@/lib/dates";
import { addDaysIso, isAvailableOn, type Schedule } from "@/lib/habits";
import {
  CALENDAR_KINDS,
  DEFAULT_KINDS,
  type CalendarItem,
  type CalendarKind,
} from "@/lib/calendar";

/**
 * The calendar, assembled from what already exists.
 *
 * No row is copied into a calendar table. Each source is queried over the
 * window and mapped to a `CalendarItem` that points back at it, so a task shown
 * on the 15th *is* the task — completing it anywhere marks it complete here,
 * and moving it here moves the task itself.
 *
 * Every date is bucketed into the user's own day. An exam at 23:30 belongs to
 * that evening, not to the next UTC morning, which is the whole reason the day
 * key is computed here rather than in the browser.
 */

export interface CalendarQuery {
  from: string;
  to: string;
  kinds: CalendarKind[];
}

/** The day an instant falls on, as seen by this user. */
function dayOf(instant: Date, timeZone: string): string {
  return todayInZone(timeZone, instant);
}

/** Minutes from midnight in the user's zone, for ordering within a day. */
function minutesOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export async function calendarSettings(userId: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });
  const zone = settings?.timezone ?? "UTC";
  return { zone, weekStartsOn: settings?.weekStartsOn ?? 1, today: todayInZone(zone) };
}

export async function calendarItems(
  userId: string,
  query: CalendarQuery,
): Promise<CalendarItem[]> {
  const { zone } = await calendarSettings(userId);

  // The window as instants, widened to the user's day boundaries so an item at
  // 23:30 on the last day is included rather than falling outside a UTC cut.
  const from = startOfCalendarDayInZone(query.from, zone);
  const to = endOfDayInZone(startOfCalendarDayInZone(query.to, zone), zone);
  const wants = (kind: CalendarKind) => query.kinds.includes(kind);

  const [tasks, events, goals, workouts, habits] = await Promise.all([
    wants("task")
      ? db.task.findMany({
          where: { userId, isTemplate: false, dueAt: { gte: from, lte: to } },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            dueHasTime: true,
            project: { select: { name: true } },
          },
          orderBy: { dueAt: "asc" },
          take: 500,
        })
      : [],

    wants("event") || wants("exam")
      ? db.event.findMany({
          where: { userId, isTemplate: false, startAt: { gte: from, lte: to } },
          select: {
            id: true,
            title: true,
            kind: true,
            startAt: true,
            endAt: true,
            allDay: true,
            location: true,
          },
          orderBy: { startAt: "asc" },
          take: 500,
        })
      : [],

    wants("goal")
      ? db.goal.findMany({
          where: { userId, targetDate: { gte: from, lte: to } },
          select: { id: true, title: true, targetDate: true, status: true },
          take: 200,
        })
      : [],

    wants("fitness")
      ? db.workoutEntry.findMany({
          where: { userId, performedAt: { gte: from, lte: to } },
          select: {
            id: true,
            activityName: true,
            performedAt: true,
            durationMinutes: true,
            caloriesBurned: true,
          },
          orderBy: { performedAt: "asc" },
          take: 500,
        })
      : [],

    wants("habit")
      ? db.habit.findMany({
          where: { userId, archivedAt: null },
          select: {
            id: true,
            name: true,
            cadence: true,
            byWeekday: true,
            targetPerWeek: true,
            startedOn: true,
            reminderMinutes: true,
            completions: {
              where: { completedOn: { gte: from, lte: to } },
              select: { completedOn: true },
            },
          },
          take: 100,
        })
      : [],
  ]);

  const items: CalendarItem[] = [];

  for (const task of tasks) {
    if (!task.dueAt) continue;
    items.push({
      key: `task:${task.id}`,
      kind: "task",
      sourceId: task.id,
      title: task.title,
      day: dayOf(task.dueAt, zone),
      startAt: task.dueHasTime ? task.dueAt.toISOString() : null,
      endAt: null,
      allDay: !task.dueHasTime,
      // The board and the calendar are the same row, so a task ticked off
      // anywhere is drawn as done here without anything syncing.
      done: task.status === "DONE" || task.status === "CANCELLED",
      href: `/tasks?focus=${task.id}`,
      minutes: task.dueHasTime ? minutesOf(task.dueAt, zone) : null,
      detail: task.project?.name ?? null,
      movable: true,
      priority: task.priority,
    });
  }

  for (const event of events) {
    const isExam = event.kind === "EXAM";
    if (isExam && !wants("exam")) continue;
    if (!isExam && !wants("event")) continue;
    items.push({
      key: `event:${event.id}`,
      kind: isExam ? "exam" : "event",
      sourceId: event.id,
      title: event.title,
      day: dayOf(event.startAt, zone),
      startAt: event.allDay ? null : event.startAt.toISOString(),
      endAt: event.allDay ? null : event.endAt.toISOString(),
      allDay: event.allDay,
      done: event.endAt < new Date(),
      href: `/events/${event.id}`,
      minutes: event.allDay ? null : minutesOf(event.startAt, zone),
      detail: event.location,
      movable: true,
    });
  }

  for (const goal of goals) {
    if (!goal.targetDate) continue;
    items.push({
      key: `goal:${goal.id}`,
      kind: "goal",
      sourceId: goal.id,
      title: goal.title,
      // A deadline is a calendar date stored at UTC midnight, so it is read
      // back in UTC. Converting it into the user's zone would shift it a day
      // for anyone west of Greenwich.
      day: goal.targetDate.toISOString().slice(0, 10),
      startAt: null,
      endAt: null,
      allDay: true,
      done: goal.status === "ACHIEVED",
      href: `/goals/${goal.id}`,
      minutes: null,
      detail: "Deadline",
      movable: true,
    });
  }

  for (const workout of workouts) {
    items.push({
      key: `fitness:${workout.id}`,
      kind: "fitness",
      sourceId: workout.id,
      title: workout.activityName,
      day: dayOf(workout.performedAt, zone),
      startAt: workout.performedAt.toISOString(),
      endAt: null,
      allDay: false,
      // A logged workout has, by definition, already happened.
      done: true,
      href: "/fitness/history",
      minutes: minutesOf(workout.performedAt, zone),
      detail: `${workout.durationMinutes} min · ${workout.caloriesBurned} kcal`,
      movable: false,
    });
  }

  /**
   * Habits are expanded, not stored.
   *
   * There is no row per day for a habit that has not been done — only a
   * schedule. So each scheduled day inside the window becomes an item, marked
   * done if a completion exists for it.
   */
  for (const habit of habits) {
    const schedule: Schedule = {
      cadence: habit.cadence,
      byWeekday: habit.byWeekday,
      targetPerWeek: habit.targetPerWeek,
      startedOn: habit.startedOn ? habit.startedOn.toISOString().slice(0, 10) : null,
    };
    const completed = new Set(
      habit.completions.map((c) => c.completedOn.toISOString().slice(0, 10)),
    );

    for (let day = query.from; day <= query.to; day = addDaysIso(day, 1)) {
      // Times-per-week habits are available every day but due on none, so
      // drawing one on all seven would be inventing an appointment.
      if (habit.cadence === "TIMES_PER_WEEK") {
        if (!completed.has(day)) continue;
      } else if (!isAvailableOn(schedule, day)) {
        continue;
      }

      items.push({
        key: `habit:${habit.id}:${day}`,
        kind: "habit",
        sourceId: habit.id,
        title: habit.name,
        day,
        startAt: null,
        endAt: null,
        allDay: true,
        done: completed.has(day),
        href: `/habits/${habit.id}`,
        minutes: habit.reminderMinutes,
        detail: "Habit",
        movable: false,
      });
    }
  }

  return items;
}

/** Everything on one day, ready for the side panel. */
export async function calendarDay(userId: string, day: string, kinds: CalendarKind[]) {
  const items = await calendarItems(userId, { from: day, to: day, kinds });
  return items.filter((item) => item.day === day);
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

/**
 * Moves an item to another day by editing the row it came from.
 *
 * This is the reason the calendar holds pointers rather than copies. Dragging a
 * task to Friday updates `Task.dueAt`; nothing is duplicated, and the board
 * shows the new date because it is reading the same column.
 *
 * The time of day is preserved. Someone moving a 10:00 exam to Thursday means
 * Thursday at 10:00, not Thursday at midnight.
 */
export async function rescheduleItem(
  userId: string,
  kind: CalendarKind,
  sourceId: string,
  day: string,
): Promise<void> {
  const { zone } = await calendarSettings(userId);
  const target = parseCalendarDate(day);
  if (!target) throw badRequest("That is not a date.");

  const shiftTo = (original: Date) => {
    const minutes = minutesOf(original, zone);
    return new Date(startOfCalendarDayInZone(day, zone).getTime() + minutes * 60_000);
  };

  switch (kind) {
    case "task": {
      const task = await db.task.findFirst({
        where: { id: sourceId, userId },
        select: { id: true, dueAt: true, dueHasTime: true },
      });
      if (!task) throw notFound("Task");
      const dueAt = task.dueAt && task.dueHasTime
        ? shiftTo(task.dueAt)
        : startOfCalendarDayInZone(day, zone);
      await db.task.update({ where: { id: sourceId }, data: { dueAt } });
      return;
    }

    case "event":
    case "exam": {
      const event = await db.event.findFirst({
        where: { id: sourceId, userId },
        select: { id: true, startAt: true, endAt: true, allDay: true },
      });
      if (!event) throw notFound("Event");
      // The duration is preserved rather than recomputed, so a 90-minute exam
      // stays 90 minutes even when it crosses a DST boundary.
      const span = event.endAt.getTime() - event.startAt.getTime();
      const startAt = event.allDay ? startOfCalendarDayInZone(day, zone) : shiftTo(event.startAt);
      await db.$transaction(async (tx) => {
        await tx.event.update({
          where: { id: sourceId },
          data: { startAt, endAt: new Date(startAt.getTime() + span) },
        });
        await recomputeRelativeEventReminders(tx, sourceId, startAt);
      });
      return;
    }

    case "goal": {
      const { count } = await db.goal.updateMany({
        where: { id: sourceId, userId },
        data: { targetDate: target },
      });
      if (count === 0) throw notFound("Goal");
      return;
    }

    case "fitness":
    case "habit":
      // A logged workout is a record of something that happened, and a habit
      // day is generated from a schedule rather than stored. Neither is a
      // plan that can be moved.
      throw badRequest(
        kind === "fitness"
          ? "A logged workout records when it actually happened, so it cannot be moved."
          : "Habits follow their schedule. Edit the habit to change which days it falls on.",
      );
  }
}

/**
 * Parses the `kinds` query string.
 *
 * An absent parameter means DEFAULT_KINDS, not every kind: habits are excluded
 * until asked for, because one daily habit puts an item on all 42 squares and
 * three of them bury the exam you opened the calendar to find.
 */
export function parseKinds(raw: string | undefined): CalendarKind[] {
  if (!raw) return [...DEFAULT_KINDS];
  const wanted = raw.split(",").map((value) => value.trim());
  const kinds = CALENDAR_KINDS.filter((kind) => wanted.includes(kind));
  return kinds.length > 0 ? kinds : [...DEFAULT_KINDS];
}

/** Whether a selection is the default, and so need not appear in the URL. */
export function isDefaultKinds(kinds: CalendarKind[]): boolean {
  return (
    kinds.length === DEFAULT_KINDS.length && DEFAULT_KINDS.every((kind) => kinds.includes(kind))
  );
}
