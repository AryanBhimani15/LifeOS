import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  calendarDay,
  calendarItems,
  isDefaultKinds,
  parseKinds,
  rescheduleItem,
} from "@/lib/repositories/calendar";
import { createEvent } from "@/lib/repositories/events";
import { createGoal } from "@/lib/repositories/goals";
import { createHabit, setCompletion } from "@/lib/repositories/habits";
import {
  addDays,
  addMonths,
  compareItems,
  groupByDay,
  layoutTimedItems,
  monthGridRange,
  monthTitle,
  rangeFor,
  scheduleLoad,
  startOfWeek,
  step,
  weekdayHeadings,
  DEFAULT_KINDS,
  type CalendarItem,
  type CalendarKind,
} from "@/lib/calendar";
import { todayInZone } from "@/lib/dates";
import { createCalendarEventSchema } from "@/lib/validation/calendar";
import { makeTwoUsers, makeUser, makeWorkout, resetDatabase } from "./helpers/factories";

/**
 * The calendar.
 *
 * The property under test throughout is that the calendar is a *view*: every
 * item points back at a real row, nothing is copied, and moving something here
 * moves the original. The failure this guards against is the obvious one — a
 * calendar that quietly becomes a second database and then disagrees with the
 * pages the data came from.
 */

const ALL: CalendarKind[] = ["task", "exam", "event", "goal", "fitness", "habit"];
const hour = 3_600_000;

async function todayFor(userId: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return todayInZone(settings?.timezone ?? "UTC");
}

beforeEach(async () => {
  await resetDatabase();
});

describe("calendar arithmetic", () => {
  it("always draws six weeks, so the grid never changes height", () => {
    for (const month of ["2026-02-01", "2026-08-01", "2026-11-01"]) {
      const { from, to } = monthGridRange(month, 1);
      const days = Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
      );
      expect(days).toBe(41);
    }
  });

  it("starts the grid on the user's chosen weekday", () => {
    expect(startOfWeek("2026-08-12", 1)).toBe("2026-08-10"); // Monday
    expect(startOfWeek("2026-08-12", 0)).toBe("2026-08-09"); // Sunday
    expect(weekdayHeadings(1)[0]).toBe("Mon");
    expect(weekdayHeadings(0)[0]).toBe("Sun");
  });

  it("rolls over the year boundary", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthTitle("2026-08-01")).toBe("August 2026");
  });

  it("steps by whatever the current view is", () => {
    expect(step("month", "2026-08-12", 1)).toBe("2026-09-01");
    expect(step("week", "2026-08-12", 1)).toBe("2026-08-19");
    expect(step("day", "2026-08-12", -1)).toBe("2026-08-11");
  });

  it("gives each view the range it needs", () => {
    expect(rangeFor("day", "2026-08-12", 1)).toEqual({ from: "2026-08-12", to: "2026-08-12" });
    expect(rangeFor("week", "2026-08-12", 1)).toEqual({ from: "2026-08-10", to: "2026-08-16" });
  });

  /** An undated task leads the day rather than pretending to be a midnight appointment. */
  it("sorts all-day items before timed ones", () => {
    const base = { kind: "task" as const, sourceId: "x", day: "2026-08-12", endAt: null, allDay: false, done: false, href: null, detail: null, movable: true };
    const allDay: CalendarItem = { ...base, key: "a", title: "Submit report", startAt: null, allDay: true, minutes: null };
    const timed: CalendarItem = { ...base, key: "b", title: "Exam", startAt: null, minutes: 600 };
    expect([timed, allDay].sort(compareItems)[0].title).toBe("Submit report");
  });

  /**
   * No filter means the default, and the default excludes habits — a daily
   * habit lands on all 42 squares of a month grid and buries everything else.
   */
  it("defaults to everything except habits, and survives a junk filter", () => {
    expect(parseKinds(undefined)).toEqual(DEFAULT_KINDS);
    expect(parseKinds(undefined)).not.toContain("habit");
    expect(parseKinds("nonsense")).toEqual(DEFAULT_KINDS);
    expect(parseKinds("task,exam")).toEqual(["task", "exam"]);
    expect(parseKinds("habit")).toEqual(["habit"]);
  });

  it("keeps the default selection out of the URL", () => {
    expect(isDefaultKinds([...DEFAULT_KINDS])).toBe(true);
    expect(isDefaultKinds([...DEFAULT_KINDS, "habit"])).toBe(false);
    expect(isDefaultKinds(["task"])).toBe(false);
  });

  it("uses transparent, unequal weights for schedule load", () => {
    const item = (kind: CalendarKind, patch: Partial<CalendarItem> = {}): CalendarItem => ({
      key: `${kind}-${Math.random()}`,
      kind,
      sourceId: "source",
      title: kind,
      day: "2026-08-14",
      startAt: null,
      endAt: null,
      allDay: true,
      done: false,
      href: null,
      minutes: null,
      detail: null,
      movable: false,
      ...patch,
    });

    expect(scheduleLoad([])).toBeNull();
    expect(scheduleLoad([item("habit")])).toMatchObject({ label: "Light" });
    expect(scheduleLoad([
      item("exam"),
      item("event"), item("event"), item("event"), item("event"),
      item("task", { priority: "HIGH" }), item("task", { priority: "HIGH" }),
    ])).toMatchObject({ label: "Very heavy" });
  });

  it("lays overlapping timed commitments side by side", () => {
    const base = (key: string, minutes: number, endAt: string): CalendarItem => ({
      key, kind: "event", sourceId: key, title: key, day: "2026-08-14",
      startAt: `2026-08-14T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00.000Z`,
      endAt, allDay: false, done: false, href: null, minutes, detail: null, movable: true,
    });
    const placements = layoutTimedItems([
      base("lecture", 600, "2026-08-14T11:00:00.000Z"),
      base("exam", 630, "2026-08-14T11:30:00.000Z"),
      base("lunch", 690, "2026-08-14T12:00:00.000Z"),
    ]);
    expect(placements.find((item) => item.item.key === "lecture")?.columns).toBe(2);
    expect(placements.find((item) => item.item.key === "exam")?.columns).toBe(2);
    expect(placements.find((item) => item.item.key === "lunch")?.column).toBe(0);
  });

  it("accepts an exam in the compact calendar entry flow", () => {
    expect(createCalendarEventSchema.parse({
      title: "DBMS CIA 2",
      kind: "EXAM",
      date: "2026-09-11",
      startTime: "10:00",
      endTime: "11:30",
      allDay: false,
    }).kind).toBe("EXAM");
  });
});

describe("what appears on the calendar", () => {
  it("shows a task on the day it is due", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    await db.task.create({
      data: {
        userId: user.id,
        title: "Write the Azure deployment section",
        dueAt: new Date(`${today}T09:00:00.000Z`),
        dueHasTime: true,
      },
    });

    const items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    const task = items.find((item) => item.kind === "task");
    expect(task?.title).toBe("Write the Azure deployment section");
    expect(task?.day).toBe(today);
    expect(task?.href).toContain("/tasks");
  });

  it("shows an exam as an exam, not as an event", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const start = new Date(`${today}T10:00:00.000Z`);
    await createEvent(user.id, {
      title: "DBMS CIA 2",
      kind: "EXAM",
      startAt: start,
      endAt: new Date(start.getTime() + 1.5 * hour),
    });

    const items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    expect(items.find((item) => item.title === "DBMS CIA 2")?.kind).toBe("exam");
  });

  it("shows a goal deadline on its date", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    await createGoal(user.id, {
      title: "Graduate with distinction",
      progressMode: "MANUAL",
      targetDate: today,
    });

    const items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    const goal = items.find((item) => item.kind === "goal");
    expect(goal?.title).toBe("Graduate with distinction");
    expect(goal?.detail).toBe("Deadline");
    expect(goal?.allDay).toBe(true);
  });

  it("shows a logged workout", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    await makeWorkout(user.id, { minutes: 45, performedAt: new Date(`${today}T18:00:00.000Z`) });

    const items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    const workout = items.find((item) => item.kind === "fitness");
    expect(workout).toBeTruthy();
    expect(workout?.detail).toContain("45 min");
    // It already happened, so it is drawn as done rather than as a plan.
    expect(workout?.done).toBe(true);
  });

  /** A completed task must read as completed here, without anything syncing. */
  it("reflects a task's completed state", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const task = await db.task.create({
      data: { userId: user.id, title: "Done already", dueAt: new Date(`${today}T09:00:00.000Z`) },
    });

    let items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    expect(items.find((item) => item.kind === "task")?.done).toBe(false);

    await db.task.update({ where: { id: task.id }, data: { status: "DONE" } });

    items = await calendarItems(user.id, { from: today, to: today, kinds: ALL });
    expect(items.find((item) => item.kind === "task")?.done).toBe(true);
  });

  it("puts everything for one day together, in order", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);

    await db.task.create({
      data: { userId: user.id, title: "Read the chapter", dueAt: new Date(`${today}T14:00:00.000Z`), dueHasTime: true },
    });
    await createEvent(user.id, {
      title: "Morning lecture",
      kind: "CLASS",
      startAt: new Date(`${today}T09:00:00.000Z`),
      endAt: new Date(`${today}T10:00:00.000Z`),
    });

    const day = await calendarDay(user.id, today, ALL);
    const ordered = day.sort(compareItems).map((item) => item.title);
    expect(ordered).toEqual(["Morning lecture", "Read the chapter"]);
  });

  it("leaves out kinds that were filtered off", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    await db.task.create({ data: { userId: user.id, title: "A task", dueAt: new Date(`${today}T09:00:00.000Z`) } });
    await createGoal(user.id, { title: "A goal", progressMode: "MANUAL", targetDate: today });

    const items = await calendarItems(user.id, { from: today, to: today, kinds: ["goal"] });
    expect(items.map((item) => item.kind)).toEqual(["goal"]);
  });

  it("keeps one person's calendar entirely out of another's", async () => {
    const { alice, bob } = await makeTwoUsers();
    const today = await todayFor(alice.id);
    await db.task.create({ data: { userId: alice.id, title: "Alice's task", dueAt: new Date(`${today}T09:00:00.000Z`) } });

    const items = await calendarItems(bob.id, { from: today, to: today, kinds: ALL });
    expect(items).toHaveLength(0);
  });
});

describe("habits on the calendar", () => {
  it("expands a daily habit across the window without storing a row per day", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Morning meditation",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "MIND",
      startedOn: addDays(today, -10),
    });
    await setCompletion(user.id, habit.id, true, today);

    const items = await calendarItems(user.id, {
      from: addDays(today, -3),
      to: today,
      kinds: ["habit"],
    });

    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.done)).toHaveLength(1);
    // Nothing was written to make those four appear.
    expect(await db.habitCompletion.count({ where: { habitId: habit.id } })).toBe(1);
  });

  it("only draws a weekly-target habit on days it was actually done", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Gym",
      cadence: "TIMES_PER_WEEK",
      byWeekday: [],
      targetPerWeek: 3,
      category: "HEALTH",
      startedOn: addDays(today, -10),
    });
    await setCompletion(user.id, habit.id, true, today);

    const items = await calendarItems(user.id, {
      from: addDays(today, -6),
      to: today,
      kinds: ["habit"],
    });

    // One completion, one item — not seven invented appointments.
    expect(items).toHaveLength(1);
    expect(items[0].day).toBe(today);
  });

  it("does not draw a weekday habit on the days it is not scheduled", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await createHabit(user.id, {
      name: "Weekly review",
      cadence: "SPECIFIC_DAYS",
      byWeekday: [weekday],
      targetPerWeek: 1,
      category: "STUDY",
      startedOn: addDays(today, -30),
    });

    const items = await calendarItems(user.id, {
      from: addDays(today, -6),
      to: today,
      kinds: ["habit"],
    });
    expect(items).toHaveLength(1);
    expect(items[0].day).toBe(today);
  });
});

describe("rescheduling moves the original", () => {
  it("moves a task by editing the task, keeping its time of day", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const task = await db.task.create({
      data: {
        userId: user.id,
        title: "Moves",
        dueAt: new Date(`${today}T09:30:00.000Z`),
        dueHasTime: true,
      },
    });
    const target = addDays(today, 3);

    await rescheduleItem(user.id, "task", task.id, target);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.dueAt?.toISOString().slice(0, 10)).toBe(target);
    expect(after.dueAt?.toISOString()).toContain("09:30");
    // One task, not two.
    expect(await db.task.count({ where: { userId: user.id } })).toBe(1);
  });

  it("moves an event and keeps its duration", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const start = new Date(`${today}T10:00:00.000Z`);
    const event = await createEvent(user.id, {
      title: "DBMS CIA 2",
      kind: "EXAM",
      startAt: start,
      endAt: new Date(start.getTime() + 1.5 * hour),
    });
    const target = addDays(today, 2);

    await rescheduleItem(user.id, "exam", event.id, target);

    const after = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.startAt.toISOString().slice(0, 10)).toBe(target);
    expect(after.endAt.getTime() - after.startAt.getTime()).toBe(1.5 * hour);
    expect(await db.event.count({ where: { userId: user.id } })).toBe(1);
  });

  it("moves a goal deadline", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const goal = await createGoal(user.id, { title: "Shifts", progressMode: "MANUAL", targetDate: today });
    const target = addDays(today, 10);

    await rescheduleItem(user.id, "goal", goal.id, target);

    const after = await db.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(after.targetDate?.toISOString().slice(0, 10)).toBe(target);
  });

  /** A workout is a record of the past; a habit day is generated. Neither moves. */
  it("refuses to move a logged workout or a habit day", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const workout = await makeWorkout(user.id, { performedAt: new Date(`${today}T18:00:00.000Z`) });
    const habit = await createHabit(user.id, { name: "Read", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "MIND" });

    await expect(rescheduleItem(user.id, "fitness", workout.id, addDays(today, 1))).rejects.toThrow(AppError);
    await expect(rescheduleItem(user.id, "habit", habit.id, addDays(today, 1))).rejects.toThrow(AppError);
  });

  it("will not move something belonging to someone else", async () => {
    const { alice, bob } = await makeTwoUsers();
    const today = await todayFor(alice.id);
    const task = await db.task.create({
      data: { userId: alice.id, title: "Alice's", dueAt: new Date(`${today}T09:00:00.000Z`) },
    });

    await expect(rescheduleItem(bob.id, "task", task.id, addDays(today, 1))).rejects.toThrow(AppError);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.dueAt?.toISOString().slice(0, 10)).toBe(today);
  });
});

describe("grouping", () => {
  it("buckets items by day with each day already ordered", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const tomorrow = addDays(today, 1);

    await db.task.create({ data: { userId: user.id, title: "Later", dueAt: new Date(`${tomorrow}T09:00:00.000Z`), dueHasTime: true } });
    await db.task.create({ data: { userId: user.id, title: "Sooner", dueAt: new Date(`${today}T09:00:00.000Z`), dueHasTime: true } });

    const grouped = groupByDay(
      await calendarItems(user.id, { from: today, to: tomorrow, kinds: ALL }),
    );

    expect(grouped.get(today)?.map((item) => item.title)).toEqual(["Sooner"]);
    expect(grouped.get(tomorrow)?.map((item) => item.title)).toEqual(["Later"]);
  });
});
