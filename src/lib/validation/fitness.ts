import { z } from "zod";
import { idSchema } from "@/lib/validation/common";
import {
  MAX_DURATION_MINUTES,
  cmToMm,
  feetInchesToMm,
  kgToGrams,
  lbToGrams,
} from "@/lib/fitness";

/**
 * Request validation for the fitness feature.
 *
 * Two things are deliberate here.
 *
 * First, every message is written to be shown to a person. "Enter a duration
 * greater than 0 minutes" tells someone what to do; "Number must be greater
 * than 0" tells them they broke something. These strings are the actual UI copy
 * for the error state, so they live with the rule they describe.
 *
 * Second, the unit conversions happen inside the schemas. A route that parses a
 * body gets canonical millimetres and grams out the other side and cannot
 * accidentally store a value in whatever unit the client happened to send.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Matches the CHECK constraints on fitness_profiles. */
const MIN_HEIGHT_MM = 500;
const MAX_HEIGHT_MM = 2600;
const MIN_WEIGHT_GRAMS = 20_000;
const MAX_WEIGHT_GRAMS = 500_000;

const heightSchema = z
  .discriminatedUnion("unit", [
    z.object({
      unit: z.literal("cm"),
      cm: z.number("Enter your height in centimetres."),
    }),
    z.object({
      unit: z.literal("ftin"),
      feet: z
        .number("Enter your height in feet and inches.")
        .int("Enter feet as a whole number.")
        .min(0, "Feet cannot be negative.")
        .max(9, "Enter 9 feet or fewer."),
      inches: z
        .number("Enter inches as a number.")
        .min(0, "Inches cannot be negative.")
        .max(11.99, "Inches must be under 12 — add a foot instead."),
    }),
  ])
  .transform((h) =>
    h.unit === "cm"
      ? { heightMm: cmToMm(h.cm), heightUnit: "cm" as const }
      : { heightMm: feetInchesToMm(h.feet, h.inches), heightUnit: "ftin" as const },
  )
  // Checked after conversion so one bound covers both unit systems.
  .refine(
    (h) => h.heightMm >= MIN_HEIGHT_MM && h.heightMm <= MAX_HEIGHT_MM,
    "That height looks off. Enter something between 50 cm and 8′ 6″.",
  );

const weightSchema = z
  .object({
    unit: z.enum(["kg", "lb"]),
    value: z.number("Enter your weight.").positive("Enter a weight greater than 0."),
  })
  .transform((w) => ({
    weightGrams: w.unit === "lb" ? lbToGrams(w.value) : kgToGrams(w.value),
    weightUnit: w.unit,
  }))
  .refine(
    (w) => w.weightGrams >= MIN_WEIGHT_GRAMS && w.weightGrams <= MAX_WEIGHT_GRAMS,
    "That weight looks off. Enter something between 20 kg and 500 kg.",
  );

export const fitnessProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter your first name.")
    .max(40, "That name is a little long — 40 characters or fewer."),
  age: z
    .number("Enter your age.")
    .int("Enter your age in whole years.")
    .min(13, "You need to be at least 13 to use this.")
    .max(120, "Enter an age of 120 or less."),
  sex: z.enum(["MALE", "FEMALE"], "Choose one to continue."),
  height: heightSchema,
  weight: weightSchema,
  activityLevel: z.enum(
    ["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE", "EXTREMELY_ACTIVE"],
    "Choose how active you usually are.",
  ),
  lifeContext: z.enum(
    ["STUDENT", "PROFESSIONAL", "STUDENT_AND_WORKING", "OTHER"],
    "Pick the one closest to your week.",
  ),
  primaryGoal: z.enum(
    ["LOSE_WEIGHT", "BUILD_STRENGTH", "IMPROVE_ENDURANCE", "STAY_HEALTHY"],
    "Choose what you're working towards.",
  ),
});

export type FitnessProfileInput = z.infer<typeof fitnessProfileSchema>;

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Duration arrives as two fields because that is how it is typed in, and each
 * needs its own message: "90" in the minutes box is fine, "-5" is not.
 *
 * The total is checked separately so 0h 0m produces the specific complaint the
 * spec asks for rather than two vague ones.
 */
export const durationSchema = z
  .object({
    hours: z
      .number("Enter hours as a number.")
      .int("Hours must be a whole number.")
      .min(0, "Hours cannot be negative.")
      .max(24, "Enter 24 hours or fewer."),
    minutes: z
      .number("Enter minutes as a number.")
      .int("Minutes must be a whole number.")
      .min(0, "Minutes cannot be negative.")
      .max(59, "Enter 59 minutes or fewer — use the hours field for more."),
  })
  .transform((d) => d.hours * 60 + d.minutes)
  .refine((total) => total > 0, "Enter a duration greater than 0 minutes.")
  .refine(
    (total) => total <= MAX_DURATION_MINUTES,
    "That is longer than a day. Enter 24 hours or less.",
  );

/**
 * A workout is identified by activity and duration only.
 *
 * The calorie total is never accepted from the client — it is recomputed from
 * the catalogue rate server-side. Otherwise anyone could POST a 50,000 kcal
 * entry and the statistics would be fiction.
 */
export const workoutInputSchema = z.object({
  activityId: idSchema,
  duration: durationSchema,
});

export type WorkoutInput = z.infer<typeof workoutInputSchema>;

/** Logging a planned session needs nothing but the session — that is the point. */
export const logPlannedSessionSchema = z.object({
  sessionId: idSchema,
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
