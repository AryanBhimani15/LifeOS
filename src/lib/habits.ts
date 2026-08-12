import type { HabitCadence, HabitCategory } from "@/generated/prisma/enums";

/**
 * What a streak actually means.
 *
 * The naive version — "consecutive days with a tick" — is wrong for every habit
 * that is not daily. A gym habit set to Monday, Wednesday and Friday would lose
 * its streak every Saturday, and a "three times a week" habit could never hold
 * one at all. So the rules here are:
 *
 *   * A day only breaks a streak if the habit was **expected** that day.
 *   * A day the habit was not scheduled is skipped entirely — it neither
 *     extends nor breaks anything.
 *   * **Today never breaks a streak.** The day is not over; someone opening the
 *     app at breakfast should not be told their 23-day streak is gone.
 *   * Days before the habit started are not misses. The habit did not exist.
 *
 * A "three times a week" habit is counted in **weeks**, not days, because there
 * is no individual day it was due — the unit is returned alongside the number
 * so the UI never renders "3 day streak" for something measured in weeks.
 *
 * Everything is a pure function over `YYYY-MM-DD` strings. The caller resolves
 * "today" in the user's own zone first (see `todayInZone`), which keeps DST and
 * travel out of this file entirely.
 */

export interface Schedule {
  cadence: HabitCadence;
  /** 0 = Sunday. Only meaningful for SPECIFIC_DAYS. */
  byWeekday: number[];
  /** Only meaningful for TIMES_PER_WEEK. */
  targetPerWeek: number;
  /** The habit did not exist before this. Null means "always". */
  startedOn: string | null;
}

export interface Streak {
  count: number;
  unit: "day" | "week";
}

// ---------------------------------------------------------------------------
// Calendar arithmetic on ISO date strings
// ---------------------------------------------------------------------------

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday, matching `byWeekday` and `weekStartsOn`. */
export function weekdayOf(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** The first day of the week containing `iso`, honouring the user's week start. */
export function weekStartOf(iso: string, weekStartsOn: number): string {
  const shift = (weekdayOf(iso) - weekStartsOn + 7) % 7;
  return addDaysIso(iso, -shift);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Had the habit begun by this date? */
function hasStarted(schedule: Schedule, iso: string): boolean {
  return !schedule.startedOn || iso >= schedule.startedOn;
}

/**
 * Was this habit *due* on this day?
 *
 * False for TIMES_PER_WEEK on every day: such a habit is never due on a
 * particular day, which is exactly why it is scored by the week instead.
 */
export function isExpectedOn(schedule: Schedule, iso: string): boolean {
  if (!hasStarted(schedule, iso)) return false;
  switch (schedule.cadence) {
    case "DAILY":
      return true;
    case "SPECIFIC_DAYS":
      return schedule.byWeekday.includes(weekdayOf(iso));
    case "TIMES_PER_WEEK":
      return false;
  }
}

/** May it be ticked off on this day? A weekly-target habit is open every day. */
export function isAvailableOn(schedule: Schedule, iso: string): boolean {
  if (!hasStarted(schedule, iso)) return false;
  return schedule.cadence === "TIMES_PER_WEEK" || isExpectedOn(schedule, iso);
}

/** How a day should be drawn in the tracker grid. */
export type DayState = "done" | "missed" | "unscheduled" | "future" | "before-start";

export function dayState(
  schedule: Schedule,
  iso: string,
  completed: ReadonlySet<string>,
  todayIso: string,
): DayState {
  if (iso > todayIso) return "future";
  if (completed.has(iso)) return "done";
  if (!hasStarted(schedule, iso)) return "before-start";
  if (!isExpectedOn(schedule, iso)) return "unscheduled";
  // Today is not a miss until it is over.
  if (iso === todayIso) return "unscheduled";
  return "missed";
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/**
 * How far back to walk before giving up.
 *
 * A guard, not a limit on real streaks: five years of daily habit is 1,826
 * iterations of integer arithmetic, and the loop stops at the habit's start
 * date or its earliest completion long before this in every real case.
 */
const HORIZON_DAYS = 2_000;

function dailyStreak(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  todayIso: string,
): number {
  let count = 0;
  let cursor = todayIso;

  for (let step = 0; step < HORIZON_DAYS; step += 1) {
    if (completed.has(cursor)) {
      // A tick always counts — on a day the habit was not due, and even on a
      // day before its recorded start. Someone filling in a day they forgot is
      // asserting they did it, and the grid would be offering a fake button if
      // that tick then changed nothing.
      count += 1;
    } else if (!hasStarted(schedule, cursor)) {
      // Out of history: before this the habit did not exist, so there is
      // nothing left that could extend the run.
      break;
    } else if (isExpectedOn(schedule, cursor) && cursor !== todayIso) {
      break;
    }

    cursor = addDaysIso(cursor, -1);
  }

  return count;
}

function weeklyStreak(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  todayIso: string,
  weekStartsOn: number,
): number {
  const target = Math.max(1, schedule.targetPerWeek);
  let count = 0;
  let weekStart = weekStartOf(todayIso, weekStartsOn);
  const thisWeek = weekStart;

  for (let step = 0; step < HORIZON_DAYS / 7; step += 1) {
    if (schedule.startedOn && addDaysIso(weekStart, 6) < schedule.startedOn) break;

    let hits = 0;
    for (let day = 0; day < 7; day += 1) {
      if (completed.has(addDaysIso(weekStart, day))) hits += 1;
    }

    if (hits >= target) {
      count += 1;
    } else if (weekStart === thisWeek) {
      // The current week is still in progress, so falling short of the target
      // is not yet a failure — skip past it without ending the run.
    } else {
      break;
    }

    weekStart = addDaysIso(weekStart, -7);
  }

  return count;
}

export function currentStreak(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  todayIso: string,
  weekStartsOn = 1,
): Streak {
  if (schedule.cadence === "TIMES_PER_WEEK") {
    return { count: weeklyStreak(schedule, completed, todayIso, weekStartsOn), unit: "week" };
  }
  return { count: dailyStreak(schedule, completed, todayIso), unit: "day" };
}

/**
 * The longest run ever achieved.
 *
 * Walked forwards from the first day that could have counted, applying the same
 * rules, so "best" and "current" can never disagree about what a streak is.
 */
export function bestStreak(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  todayIso: string,
  weekStartsOn = 1,
): Streak {
  const dates = [...completed].sort();
  // The earlier of "when it started" and "the first day recorded", for the same
  // reason as above: a back-filled day is part of the history.
  const candidates = [schedule.startedOn, dates[0]].filter((d): d is string => Boolean(d));
  const earliest = candidates.length ? candidates.reduce((a, b) => (a < b ? a : b)) : undefined;
  if (!earliest || earliest > todayIso) {
    return { count: 0, unit: schedule.cadence === "TIMES_PER_WEEK" ? "week" : "day" };
  }

  if (schedule.cadence === "TIMES_PER_WEEK") {
    const target = Math.max(1, schedule.targetPerWeek);
    let best = 0;
    let run = 0;
    let weekStart = weekStartOf(earliest, weekStartsOn);
    const lastWeek = weekStartOf(todayIso, weekStartsOn);

    while (weekStart <= lastWeek) {
      let hits = 0;
      for (let day = 0; day < 7; day += 1) {
        if (completed.has(addDaysIso(weekStart, day))) hits += 1;
      }
      if (hits >= target) {
        run += 1;
        best = Math.max(best, run);
      } else if (weekStart !== lastWeek) {
        run = 0;
      }
      weekStart = addDaysIso(weekStart, 7);
    }
    return { count: best, unit: "week" };
  }

  let best = 0;
  let run = 0;
  for (let cursor = earliest; cursor <= todayIso; cursor = addDaysIso(cursor, 1)) {
    if (completed.has(cursor)) {
      run += 1;
      best = Math.max(best, run);
    } else if (isExpectedOn(schedule, cursor) && cursor !== todayIso) {
      run = 0;
    }
  }
  return { count: best, unit: "day" };
}

/**
 * Completions as a percentage of what was actually asked for.
 *
 * The denominator is expected days (or expected weekly slots), never elapsed
 * days — otherwise a three-days-a-week habit done perfectly would report 43%.
 *
 * Returns **null** when nothing was expected in the window at all: a habit
 * created today on a day it is not scheduled has not kept 0% of anything, and
 * telling someone they are at 0% before their first due day is both wrong and
 * the kind of thing that makes people give up in week one.
 */
export function completionRate(
  schedule: Schedule,
  completed: ReadonlySet<string>,
  fromIso: string,
  toIso: string,
  weekStartsOn = 1,
): number | null {
  if (toIso < fromIso) return null;
  const start = schedule.startedOn && schedule.startedOn > fromIso ? schedule.startedOn : fromIso;
  if (start > toIso) return null;

  if (schedule.cadence === "TIMES_PER_WEEK") {
    const target = Math.max(1, schedule.targetPerWeek);
    let expected = 0;
    let done = 0;
    let weekStart = weekStartOf(start, weekStartsOn);
    const lastWeek = weekStartOf(toIso, weekStartsOn);
    while (weekStart <= lastWeek) {
      expected += target;
      for (let day = 0; day < 7; day += 1) {
        const iso = addDaysIso(weekStart, day);
        if (iso >= start && iso <= toIso && completed.has(iso)) done += 1;
      }
      weekStart = addDaysIso(weekStart, 7);
    }
    return expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100));
  }

  let expected = 0;
  let done = 0;
  for (let cursor = start; cursor <= toIso; cursor = addDaysIso(cursor, 1)) {
    if (!isExpectedOn(schedule, cursor)) continue;
    expected += 1;
    if (completed.has(cursor)) done += 1;
  }
  return expected === 0 ? null : Math.round((done / expected) * 100);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "Daily", "Mon, Wed, Fri", "3× a week", "Weekly". */
export function cadenceLabel(schedule: Schedule): string {
  switch (schedule.cadence) {
    case "DAILY":
      return "Daily";
    case "SPECIFIC_DAYS": {
      const days = [...schedule.byWeekday].sort((a, b) => a - b);
      if (days.length === 0) return "No days chosen";
      if (days.length === 7) return "Daily";
      return days.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join(", ");
    }
    case "TIMES_PER_WEEK":
      return schedule.targetPerWeek === 1 ? "Weekly" : `${schedule.targetPerWeek}× a week`;
  }
}

/**
 * "23 day streak", not "23 days streak" — the unit is attributive here, the
 * same way nobody says "a five days week".
 */
export function streakLabel(streak: Streak): string {
  if (streak.count === 0) return "No streak yet";
  return `${streak.count} ${streak.unit} streak`;
}

/** 420 → "7:00 AM". Minutes from local midnight, never an instant. */
export function reminderLabel(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "07:00" → 420. Returns null for anything that is not a time. */
export function parseReminder(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 420 → "07:00", for an `<input type="time">`. */
export function reminderInputValue(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export const HABIT_CATEGORIES: { value: HabitCategory; label: string }[] = [
  { value: "HEALTH", label: "Health" },
  { value: "MIND", label: "Mind" },
  { value: "STUDY", label: "Study" },
  { value: "PERSONAL", label: "Personal" },
  { value: "OTHER", label: "Other" },
];

/** Closed icon set, for the same reason goals have one: the value reaches the DOM. */
export const HABIT_ICONS = [
  "sparkles",
  "droplet",
  "book-open",
  "dumbbell",
  "brain",
  "moon",
  "sun",
  "footprints",
  "pen-line",
  "heart",
] as const;

export type HabitIconName = (typeof HABIT_ICONS)[number];

export const DEFAULT_HABIT_ICON: HabitIconName = "sparkles";

export function isHabitIcon(value: unknown): value is HabitIconName {
  return typeof value === "string" && (HABIT_ICONS as readonly string[]).includes(value);
}
