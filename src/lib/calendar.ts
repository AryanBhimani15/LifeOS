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
  /** Present for dated tasks so the planning indicator can respect urgency. */
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
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
// Schedule load and timed layout
// ---------------------------------------------------------------------------

/**
 * A transparent planning-density label, never a stress or wellbeing score.
 *
 * Exams deliberately outweigh normal events and a task deadline contributes
 * more when its underlying task was marked urgent. The thresholds are small on
 * purpose: they distinguish a quiet day from a class/exam-heavy college day
 * without producing an intimidating heatmap or a fake percentage.
 */
export type ScheduleLoadLabel = "Light" | "Moderate" | "Heavy" | "Very heavy";

export interface ScheduleLoad {
  score: number;
  label: ScheduleLoadLabel;
}

const LOAD_WEIGHT: Record<CalendarKind, number> = {
  task: 2,
  exam: 8,
  event: 3,
  goal: 3,
  fitness: 2,
  habit: 1,
};

const TASK_PRIORITY_WEIGHT: Record<NonNullable<CalendarItem["priority"]>, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  URGENT: 3,
};

/** Returns null for a genuinely clear day. */
export function scheduleLoad(items: CalendarItem[]): ScheduleLoad | null {
  let score = 0;

  for (const item of items) {
    score += LOAD_WEIGHT[item.kind];
    if (item.kind === "task" && item.priority) score += TASK_PRIORITY_WEIGHT[item.priority];

    // A long scheduled commitment is busier than a short meeting. All-day
    // deadlines intentionally get no time bonus — they are deadlines, not a
    // pretend 24-hour appointment.
    if (!item.allDay && item.startAt && item.endAt) {
      const duration = Math.max(0, new Date(item.endAt).getTime() - new Date(item.startAt).getTime());
      score += Math.min(2, Math.floor(duration / 60 / 60_000));
    }
  }

  if (score === 0) return null;
  if (score <= 3) return { score, label: "Light" };
  if (score <= 7) return { score, label: "Moderate" };
  if (score <= 13) return { score, label: "Heavy" };
  return { score, label: "Very heavy" };
}

export interface TimedPlacement {
  item: CalendarItem;
  start: number;
  end: number;
  column: number;
  columns: number;
}

/**
 * Allocates columns inside an overlap cluster. The calculated placements let
 * week/day render timed commitments side-by-side instead of hiding a lecture
 * behind an exam that starts at the same time.
 */
export function layoutTimedItems(items: CalendarItem[]): TimedPlacement[] {
  const sorted = items
    .filter((item) => !item.allDay && item.minutes !== null)
    .map((item) => {
      const start = item.minutes ?? 0;
      const duration = item.startAt && item.endAt
        ? Math.max(30, Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60_000))
        : 45;
      return { item, start, end: Math.min(24 * 60, start + duration) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.item.title.localeCompare(b.item.title));

  const output: TimedPlacement[] = [];
  let active: TimedPlacement[] = [];
  let cluster: TimedPlacement[] = [];
  let clusterColumns = 0;

  const finishCluster = () => {
    for (const placement of cluster) placement.columns = Math.max(1, clusterColumns);
    cluster = [];
    clusterColumns = 0;
  };

  for (const candidate of sorted) {
    active = active.filter((placement) => placement.end > candidate.start);
    if (active.length === 0 && cluster.length > 0) finishCluster();
    const used = new Set(active.map((placement) => placement.column));
    let column = 0;
    while (used.has(column)) column += 1;
    const placement: TimedPlacement = { ...candidate, column, columns: 1 };
    output.push(placement);
    active.push(placement);
    cluster.push(placement);
    clusterColumns = Math.max(clusterColumns, active.length);
  }
  if (cluster.length > 0) finishCluster();

  return output;
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
