import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
  addCalendarDays,
  endOfDayInZone,
  startOfCalendarDayInZone,
  todayInZone,
} from "@/lib/dates";
import { calculateBurn } from "@/lib/fitness";
import type { FitnessProfileInput, WorkoutInput } from "@/lib/validation/fitness";

/**
 * Data access for onboarding, the calculator and its history.
 *
 * Every query that touches user data is scoped by `userId` in its where clause,
 * including the deletes — `delete({ where: { id } })` with a separate ownership
 * check has a window between the two, and there is no reason to leave one open.
 * The activity catalogue is the only unscoped table here because it is shared
 * reference data that contains nothing about anyone.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type FitnessProfile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

export function getProfile(userId: string) {
  return db.fitnessProfile.findUnique({
    where: { userId },
    select: {
      firstName: true,
      age: true,
      sex: true,
      heightMm: true,
      weightGrams: true,
      heightUnit: true,
      weightUnit: true,
      activityLevel: true,
      lifeContext: true,
      primaryGoal: true,
      completedAt: true,
      updatedAt: true,
    },
  });
}

/**
 * True once the last onboarding step has been submitted.
 *
 * A row with a null `completedAt` means someone started the flow and left; they
 * are sent back into it rather than into a dashboard that has no name to greet.
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const count = await db.fitnessProfile.count({
    where: { userId, completedAt: { not: null } },
  });
  return count > 0;
}

/**
 * Writes the onboarding answers.
 *
 * An upsert rather than a create so that re-running the flow — from Settings,
 * or after a half-finished attempt — updates in place instead of colliding with
 * the unique constraint on userId.
 */
export async function saveProfile(userId: string, input: FitnessProfileInput) {
  const fields = {
    firstName: input.firstName,
    age: input.age,
    sex: input.sex,
    heightMm: input.height.heightMm,
    heightUnit: input.height.heightUnit,
    weightGrams: input.weight.weightGrams,
    weightUnit: input.weight.weightUnit,
    activityLevel: input.activityLevel,
    lifeContext: input.lifeContext,
    primaryGoal: input.primaryGoal,
    completedAt: new Date(),
  };

  return db.fitnessProfile.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
    select: { firstName: true, completedAt: true },
  });
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export type Activity = Awaited<ReturnType<typeof listActivities>>[number];

export function listActivities() {
  return db.activity.findMany({
    where: { archived: false },
    select: { id: true, slug: true, name: true, icon: true, caloriesPerHour: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

async function requireActivity(activityId: string) {
  const activity = await db.activity.findFirst({
    where: { id: activityId, archived: false },
    select: { id: true, name: true, icon: true, caloriesPerHour: true },
  });
  if (!activity) throw notFound("Activity");
  return activity;
}

// ---------------------------------------------------------------------------
// Calculation and history
// ---------------------------------------------------------------------------

export interface BurnResult {
  activityId: string;
  activityName: string;
  activityIcon: string;
  caloriesPerHour: number;
  durationMinutes: number;
  caloriesBurned: number;
}

/** Works out a result without saving it — what the Calculate button calls. */
export async function previewBurn(input: WorkoutInput): Promise<BurnResult> {
  const activity = await requireActivity(input.activityId);
  return {
    activityId: activity.id,
    activityName: activity.name,
    activityIcon: activity.icon,
    caloriesPerHour: activity.caloriesPerHour,
    durationMinutes: input.duration,
    caloriesBurned: calculateBurn(activity.caloriesPerHour, input.duration),
  };
}

/**
 * Saves a result to history.
 *
 * The rate is read from the catalogue here rather than taken from the preview
 * the client is holding, so a tampered or simply stale preview cannot write a
 * number the catalogue does not support.
 */
export async function saveWorkout(userId: string, input: WorkoutInput) {
  const activity = await requireActivity(input.activityId);

  return db.workoutEntry.create({
    data: {
      userId,
      activityId: activity.id,
      activityName: activity.name,
      activityIcon: activity.icon,
      caloriesPerHour: activity.caloriesPerHour,
      durationMinutes: input.duration,
      caloriesBurned: calculateBurn(activity.caloriesPerHour, input.duration),
    },
    select: HISTORY_FIELDS,
  });
}

const HISTORY_FIELDS = {
  id: true,
  activityName: true,
  activityIcon: true,
  caloriesPerHour: true,
  durationMinutes: true,
  caloriesBurned: true,
  performedAt: true,
} as const;

export type HistoryEntry = Awaited<ReturnType<typeof listHistory>>[number];

export function listHistory(userId: string, limit = 50) {
  return db.workoutEntry.findMany({
    where: { userId },
    select: HISTORY_FIELDS,
    orderBy: { performedAt: "desc" },
    take: limit,
  });
}

/**
 * Deletes one entry.
 *
 * `deleteMany` scoped to (id, userId) rather than `delete` by id: it is a
 * single statement that cannot delete another user's row, and a count of 0
 * tells us the id was wrong or not theirs — reported as 404 either way, so the
 * response never confirms that someone else's entry exists.
 */
export async function deleteWorkout(userId: string, id: string): Promise<void> {
  const { count } = await db.workoutEntry.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Workout");
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface DayStat {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Short weekday name for the chart axis. */
  label: string;
  calories: number;
  workouts: number;
  minutes: number;
  isToday: boolean;
}

export interface FitnessStats {
  zone: string;
  today: { calories: number; workouts: number; minutes: number };
  week: DayStat[];
  weekTotal: number;
  /** The largest single day this week, used to scale the chart. */
  weekBest: number;
  streakDays: number;
}

/**
 * Daily and weekly totals, bucketed by the user's own calendar.
 *
 * A workout at 11pm belongs to that evening, not to the next UTC day, so every
 * boundary is resolved in the user's zone. The week starts on whichever day
 * their settings say, which is why the chart is built from a date list rather
 * than assuming Monday.
 */
export async function getFitnessStats(userId: string): Promise<FitnessStats> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });
  const zone = settings?.timezone ?? "UTC";
  const weekStartsOn = settings?.weekStartsOn ?? 1;

  const today = todayInZone(zone);
  // getUTCDay on the local date at UTC midnight is the local weekday.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const daysIntoWeek = (weekday - weekStartsOn + 7) % 7;
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    addCalendarDays(today, i - daysIntoWeek),
  );

  const windowStart = startOfCalendarDayInZone(weekDates[0], zone);
  const windowEnd = endOfDayInZone(startOfCalendarDayInZone(weekDates[6], zone), zone);

  const entries = await db.workoutEntry.findMany({
    where: { userId, performedAt: { gte: windowStart, lte: windowEnd } },
    select: { performedAt: true, caloriesBurned: true, durationMinutes: true },
  });

  const buckets = new Map<string, { calories: number; workouts: number; minutes: number }>();
  for (const date of weekDates) buckets.set(date, { calories: 0, workouts: 0, minutes: 0 });

  for (const entry of entries) {
    const bucket = buckets.get(todayInZone(zone, entry.performedAt));
    if (!bucket) continue; // Boundary rounding; the window already excludes the rest.
    bucket.calories += entry.caloriesBurned;
    bucket.workouts += 1;
    bucket.minutes += entry.durationMinutes;
  }

  const week: DayStat[] = weekDates.map((date) => {
    const bucket = buckets.get(date)!;
    return {
      date,
      label: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
        new Date(`${date}T00:00:00Z`),
      ),
      ...bucket,
      isToday: date === today,
    };
  });

  return {
    zone,
    today: buckets.get(today) ?? { calories: 0, workouts: 0, minutes: 0 },
    week,
    weekTotal: week.reduce((sum, day) => sum + day.calories, 0),
    weekBest: week.reduce((max, day) => Math.max(max, day.calories), 0),
    streakDays: await activeStreak(userId, zone, today),
  };
}

/**
 * Consecutive days ending today on which something was logged.
 *
 * Counts back from yesterday when today is still empty, so the number does not
 * reset to zero every morning before the first workout — the same rule the
 * habit streaks use.
 */
async function activeStreak(userId: string, zone: string, today: string): Promise<number> {
  const horizon = startOfCalendarDayInZone(addCalendarDays(today, -365), zone);
  const entries = await db.workoutEntry.findMany({
    where: { userId, performedAt: { gte: horizon } },
    select: { performedAt: true },
    orderBy: { performedAt: "desc" },
  });

  const active = new Set(entries.map((e) => todayInZone(zone, e.performedAt)));
  let cursor = active.has(today) ? today : addCalendarDays(today, -1);

  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  return streak;
}
