/**
 * The calendar's vocabulary.
 *
 * LifeOS does not have a calendar database. It has tasks with due dates, events
 * with start and end times, exams, goal deadlines, logged workouts and habit
 * schedules — and the calendar is a *view* over all of them. Every item on
 * screen is a pointer back to the row it came from, which is what makes
 * "reschedule it here and the task moves" possible, and what stops the calendar
 * becoming a second copy of everything that then drifts.
 *
 * Everything below is pure and works on `YYYY-MM-DD` strings plus ISO instants.
 * The user's zone is resolved once, at the repository edge.
 */

export const CALENDAR_KINDS = ["task", "exam", "event", "goal", "fitness", "habit"] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export interface CalendarItem {
  /** Unique across sources: "task:abc123". Two sources can share a row id. */
  key: string;
  kind: CalendarKind;
  /** The id of the underlying row, for links and rescheduling. */
  sourceId: string;
  title: string;
  /** The day it belongs to, in the user's zone. */
  day: string;
  /** ISO instant, or null for something with no time of day. */
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  /** Completed, done, achieved — whatever "finished" means for this kind. */
  done: boolean;
  /** Where clicking it goes. Null when the kind has no detail page. */
  href: string | null;
  /** Minutes from midnight, for ordering within a day. All-day items sort first. */
  minutes: number | null;
  /** Extra line for the day panel: a location, a duration, a streak. */
  detail: string | null;
  /** Whether this item's date can be changed from the calendar. */
  movable: boolean;
}

export const KIND_LABEL: Record<CalendarKind, string> = {
  task: "Tasks",
  exam: "Exams",
  event: "Events",
  goal: "Goals",
  fitness: "Fitness",
  habit: "Habits",
};

/**
 * Habits are off by default.
 *
 * A daily habit puts an item on every square of the month. Three of them and
 * the grid is nothing but habits, with the exam you were looking for hidden
 * behind "+4 more". They stay one click away instead.
 */
export const DEFAULT_KINDS: CalendarKind[] = ["task", "exam", "event", "goal", "fitness"];

// ---------------------------------------------------------------------------
// Calendar arithmetic, on YYYY-MM-DD strings
// ---------------------------------------------------------------------------

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return new Date(utc(iso)).getUTCDay();
}

export function startOfWeek(iso: string, weekStartsOn: number): string {
  return addDays(iso, -((weekdayOf(iso) - weekStartsOn + 7) % 7));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The six-week window a month grid actually draws.
 *
 * Always six rows, never five-or-six: a grid that changes height as you page
 * through the year makes the whole page jump, and every control below it moves.
 */
export function monthGridRange(monthIso: string, weekStartsOn: number) {
  const first = startOfMonth(monthIso);
  const from = startOfWeek(first, weekStartsOn);
  return { from, to: addDays(from, 41) };
}

export function rangeFor(
  view: CalendarView,
  anchor: string,
  weekStartsOn: number,
): { from: string; to: string } {
  switch (view) {
    case "month":
      return monthGridRange(anchor, weekStartsOn);
    case "week": {
      const from = startOfWeek(anchor, weekStartsOn);
      return { from, to: addDays(from, 6) };
    }
    case "day":
      return { from: anchor, to: anchor };
    case "agenda":
      return { from: anchor, to: addDays(anchor, 29) };
  }
}

export type CalendarView = "month" | "week" | "day" | "agenda";

/** Moves the anchor date by one step of whatever view is showing. */
export function step(view: CalendarView, anchor: string, direction: 1 | -1): string {
  switch (view) {
    case "month":
      return addMonths(startOfMonth(anchor), direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "day":
      return addDays(anchor, direction);
    case "agenda":
      return addDays(anchor, 30 * direction);
  }
}

// ---------------------------------------------------------------------------
// Grouping and ordering
// ---------------------------------------------------------------------------

/** Items keyed by day, each day's list already in the order it should render. */
export function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = byDay.get(item.day);
    if (list) list.push(item);
    else byDay.set(item.day, [item]);
  }
  for (const list of byDay.values()) list.sort(compareItems);
  return byDay;
}

/**
 * All-day things first, then by clock time, then by name.
 *
 * An exam at 10:00 and a task due "on Thursday" are not comparable as instants
 * — the task has no time at all — so the undated one leads the day rather than
 * being dropped at midnight and pretending to be the first appointment.
 */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.minutes === null && b.minutes !== null) return -1;
  if (a.minutes !== null && b.minutes === null) return 1;
  if (a.minutes !== null && b.minutes !== null && a.minutes !== b.minutes) {
    return a.minutes - b.minutes;
  }
  return a.title.localeCompare(b.title);
}

export function dayCells(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "10:00 AM" in the user's zone, or null for an all-day item. */
export function timeLabel(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(iso));
}

export function timeRangeLabel(
  startAt: string | null,
  endAt: string | null,
  allDay: boolean,
  timeZone: string,
): string {
  if (allDay || !startAt) return "All day";
  const start = timeLabel(startAt, timeZone);
  const end = endAt ? timeLabel(endAt, timeZone) : null;
  return end && end !== start ? `${start} – ${end}` : (start ?? "All day");
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_FULL = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const asUtcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export function monthTitle(iso: string): string {
  return MONTH_YEAR.format(asUtcDate(iso));
}

export function dayTitle(iso: string): string {
  return DAY_FULL.format(asUtcDate(iso));
}

/** "12 – 18 Aug 2026", collapsing the parts both ends share. */
export function weekTitle(from: string, to: string): string {
  const start = asUtcDate(from);
  const end = asUtcDate(to);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "UTC" }).format(date);
  const monthYear = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return sameMonth
    ? `${day(start)} – ${day(end)} ${monthYear.format(end)}`
    : `${day(start)} ${monthYear.format(start)} – ${day(end)} ${monthYear.format(end)}`;
}

export function viewTitle(view: CalendarView, anchor: string, weekStartsOn: number): string {
  switch (view) {
    case "month":
      return monthTitle(anchor);
    case "week": {
      const { from, to } = rangeFor("week", anchor, weekStartsOn);
      return weekTitle(from, to);
    }
    case "day":
      return dayTitle(anchor);
    case "agenda":
      return `From ${dayTitle(anchor)}`;
  }
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Weekday headings, rotated to wherever the user's week starts. */
export function weekdayHeadings(weekStartsOn: number): string[] {
  return Array.from({ length: 7 }, (_, index) => WEEKDAY_SHORT[(weekStartsOn + index) % 7]);
}

export { TIME };
