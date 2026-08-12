import { z } from "zod";
import { idSchema, isoDate, longText, title } from "./common";
import { HABIT_ICONS } from "@/lib/habits";

/** Validation for habits and their completions. */

export const habitCadence = z.enum(["DAILY", "SPECIFIC_DAYS", "TIMES_PER_WEEK"]);
export const habitCategory = z.enum(["HEALTH", "MIND", "STUDY", "PERSONAL", "OTHER"]);
export const habitIcon = z.enum(HABIT_ICONS);

/** 0 = Sunday, matching `weekStartsOn` and the stored `byWeekday`. */
const weekday = z.number().int().min(0).max(6);

const habitFields = {
  name: title(120),
  description: longText(2_000).nullish(),
  category: habitCategory.default("OTHER"),
  icon: habitIcon.nullish(),
  cadence: habitCadence.default("DAILY"),
  byWeekday: z.array(weekday).max(7).default([]),
  targetPerWeek: z.number().int().min(1).max(7).default(7),
  /** "07:00" as typed by an `<input type="time">`. Converted to minutes later. */
  reminder: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 07:00")
    .nullish(),
  startedOn: isoDate.nullish(),
  goalId: idSchema.nullish(),
};

/**
 * A schedule has to be answerable.
 *
 * "Specific days" with no days chosen would be a habit that is never due, which
 * silently means it can never hold a streak and never appear as today's work.
 * Refusing it here is kinder than rendering a habit that quietly does nothing.
 */
const schedulable = (data: { cadence?: string; byWeekday?: number[] }) =>
  data.cadence !== "SPECIFIC_DAYS" || (data.byWeekday?.length ?? 0) > 0;

export const createHabitSchema = z.object(habitFields).refine(schedulable, {
  message: "Pick at least one day of the week.",
  path: ["byWeekday"],
});

export const updateHabitSchema = z
  .object({
    ...habitFields,
    name: habitFields.name.optional(),
    cadence: habitCadence.optional(),
    category: habitCategory.optional(),
    byWeekday: z.array(weekday).max(7).optional(),
    targetPerWeek: z.number().int().min(1).max(7).optional(),
    archived: z.boolean().optional(),
  })
  .refine(schedulable, {
    message: "Pick at least one day of the week.",
    path: ["byWeekday"],
  });

/**
 * Marking a day done or undone.
 *
 * The date is explicit rather than assumed to be today, because the tracker
 * grid lets someone fix a day they forgot to tick. The repository is what
 * refuses a future date — a client that omits `on` still means today.
 */
export const setCompletionSchema = z.object({
  on: isoDate.optional(),
  done: z.boolean(),
});

export const listHabitsSchema = z.object({
  category: z.enum(["ALL", "HEALTH", "MIND", "STUDY", "PERSONAL", "OTHER"]).default("ALL"),
  view: z.enum(["today", "weekly", "monthly"]).default("today"),
});

export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;
export type ListHabitsQuery = z.infer<typeof listHabitsSchema>;
