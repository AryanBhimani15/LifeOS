import type { GoalProgressMode } from "@/generated/prisma/enums";

/**
 * Goal progress: one number, one source.
 *
 * A goal's percentage is derived from exactly the mode it was created with.
 * Nothing here blends sources, because a blended number cannot be explained to
 * the person reading it and moves the wrong way when they add work. What this
 * file guarantees instead is that every percentage on screen has a sentence
 * behind it — "8 of 12 books", "3 of 5 milestones" — which `progressDetail`
 * returns alongside it.
 */

/** Amounts are stored as integer thousandths. See the schema comment. */
export function fromMilli(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value) / 1000;
}

export function toMilli(value: number): bigint {
  return BigInt(Math.round(value * 1000));
}

/** Largest amount a goal may hold, in whole units. Keeps BigInt sane and inputs honest. */
export const MAX_GOAL_VALUE = 1_000_000_000;

export interface ProgressSources {
  progressMode: GoalProgressMode;
  manualPercent: number;
  currentMilli: bigint | number;
  targetMilli: bigint | number | null;
  milestonesTotal: number;
  milestonesDone: number;
  tasksTotal: number;
  tasksDone: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const ratio = (done: number, total: number) => (total <= 0 ? 0 : clamp((done / total) * 100));

/**
 * The percentage, 0–100.
 *
 * A mode whose source is empty reads 0 rather than 100: a goal with no
 * milestones yet has not been achieved, even though "all of them" are done.
 */
export function goalPercent(goal: ProgressSources): number {
  switch (goal.progressMode) {
    case "MANUAL":
      return clamp(goal.manualPercent);
    case "NUMERIC": {
      const target = fromMilli(goal.targetMilli);
      if (target <= 0) return 0;
      return clamp((fromMilli(goal.currentMilli) / target) * 100);
    }
    case "MILESTONES":
      return ratio(goal.milestonesDone, goal.milestonesTotal);
    case "TASKS":
      return ratio(goal.tasksDone, goal.tasksTotal);
  }
}

/**
 * A unit is a suffix ("12 books") unless it looks like a currency symbol, in
 * which case it is a prefix ("₹45,000"). Judged by shape, not by a currency
 * list, so "$", "€" and "₹" all work without one.
 */
function isSymbol(unit: string): boolean {
  return unit.length <= 2 && !/[a-z0-9]/i.test(unit);
}

const NUMBER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export function formatAmount(value: number, unit: string | null | undefined): string {
  const text = NUMBER.format(value);
  if (!unit) return text;
  return isSymbol(unit) ? `${unit}${text}` : `${text} ${unit}`;
}

/** The sentence under the bar: what the percentage is actually counting. */
export function progressDetail(goal: ProgressSources & { unit?: string | null }): string {
  switch (goal.progressMode) {
    case "MANUAL":
      return "Updated by hand";
    case "NUMERIC": {
      const target = fromMilli(goal.targetMilli);
      if (target <= 0) return "No target set";
      // A prefix repeats naturally ("₹45,000 of ₹1,00,000"); a suffix does not
      // ("3.5 km of 5 km" is how nobody says it), so it is written once.
      const unit = goal.unit ?? null;
      const prefixed = unit !== null && isSymbol(unit);
      return `${formatAmount(fromMilli(goal.currentMilli), prefixed ? unit : null)} of ${formatAmount(target, unit)}`;
    }
    case "MILESTONES":
      return goal.milestonesTotal === 0
        ? "No milestones yet"
        : `${goal.milestonesDone} of ${goal.milestonesTotal} milestone${goal.milestonesTotal === 1 ? "" : "s"}`;
    case "TASKS":
      return goal.tasksTotal === 0
        ? "No tasks linked yet"
        : `${goal.tasksDone} of ${goal.tasksTotal} task${goal.tasksTotal === 1 ? "" : "s"} done`;
  }
}

/**
 * The icon set. A stored icon is a key from this list, never arbitrary markup —
 * the value reaches the DOM, so an open string field would be a stored-XSS
 * shaped hole for no benefit.
 */
export const GOAL_ICONS = [
  "target",
  "graduation-cap",
  "wallet",
  "dumbbell",
  "book-open",
  "brain",
  "heart",
  "sprout",
  "code",
  "plane",
] as const;

export type GoalIcon = (typeof GOAL_ICONS)[number];

export const DEFAULT_GOAL_ICON: GoalIcon = "target";

export function isGoalIcon(value: unknown): value is GoalIcon {
  return typeof value === "string" && (GOAL_ICONS as readonly string[]).includes(value);
}

/** Suggestions, not a closed set — the field accepts anything the user types. */
export const GOAL_CATEGORIES = [
  "Study",
  "Health",
  "Money",
  "Career",
  "Personal",
  "Creative",
] as const;

export const PROGRESS_MODES: { value: GoalProgressMode; label: string; hint: string }[] = [
  { value: "MANUAL", label: "Percentage", hint: "You set the number yourself." },
  { value: "NUMERIC", label: "A number to reach", hint: "₹45,000 of ₹100,000 · 8 of 12 books." },
  { value: "MILESTONES", label: "Milestones", hint: "Progress is completed milestones." },
  { value: "TASKS", label: "Linked tasks", hint: "Progress is linked tasks marked done." },
];

/**
 * Days between two calendar dates, both as YYYY-MM-DD. Negative once past.
 *
 * Deliberately string-in: a deadline is stored as UTC midnight and "today" is
 * the user's own day from `todayInZone`. Comparing the two as calendar dates is
 * exact and survives DST, whereas subtracting the instants is off by an offset
 * and flips the answer for anyone west of UTC late in the evening.
 */
export function daysUntil(targetIso: string, todayIso: string): number {
  const at = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(targetIso) - at(todayIso)) / 86_400_000);
}

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "Due today", "3 days overdue", "Due 30 May". Null when there is no deadline. */
export function deadlineLabel(target: Date | null, todayIso: string): string | null {
  if (!target) return null;
  const days = daysUntil(target.toISOString().slice(0, 10), todayIso);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  return `Due ${DAY_MONTH.format(target)}`;
}
