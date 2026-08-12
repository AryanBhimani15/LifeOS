/**
 * Fitness domain logic: units, burn arithmetic, and the labels the UI reads from.
 *
 * Everything here is pure. The rule this module exists to enforce is that no
 * React component ever does unit maths or decides what a calorie number means —
 * those are decisions with a right answer, and a right answer belongs somewhere
 * a test can reach it.
 */

import type { ActivityLevel, LifeContext, PrimaryGoal, Sex } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * Height and weight are stored as integer millimetres and grams.
 *
 * Both are entered in two different unit systems and read back in whichever one
 * the user prefers, so every value makes at least one round trip through a
 * conversion. Floats accumulate error across those trips: 5'10" stored as
 * 177.79999999999998 cm is redisplayed as 5'9". Integers in a fine base do not
 * have that problem, which is the same reasoning as money in minor units.
 */

const MM_PER_INCH = 25.4;
const INCHES_PER_FOOT = 12;
const GRAMS_PER_POUND = 453.59237;

export type HeightUnit = "cm" | "ftin";
export type WeightUnit = "kg" | "lb";

export const cmToMm = (cm: number): number => Math.round(cm * 10);
export const mmToCm = (mm: number): number => Math.round(mm / 10);

export function feetInchesToMm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * MM_PER_INCH);
}

/**
 * Splits millimetres into whole feet and inches.
 *
 * Rounding the inches first is what makes this safe: 71.6 inches must read as
 * 6'0", not 5'12". Anything that rounds up to a full foot carries.
 */
export function mmToFeetInches(mm: number): { feet: number; inches: number } {
  const totalInches = Math.round(mm / MM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export const kgToGrams = (kg: number): number => Math.round(kg * 1000);
export const gramsToKg = (grams: number): number => grams / 1000;
export const lbToGrams = (lb: number): number => Math.round(lb * GRAMS_PER_POUND);
export const gramsToLb = (grams: number): number => grams / GRAMS_PER_POUND;

/** One decimal place, with a trailing ".0" trimmed — "72 kg", not "72.0 kg". */
function trim(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function formatHeight(heightMm: number, unit: HeightUnit): string {
  if (unit === "ftin") {
    const { feet, inches } = mmToFeetInches(heightMm);
    return `${feet}′ ${inches}″`;
  }
  return `${mmToCm(heightMm)} cm`;
}

export function formatWeight(weightGrams: number, unit: WeightUnit): string {
  return unit === "lb"
    ? `${trim(gramsToLb(weightGrams))} lb`
    : `${trim(gramsToKg(weightGrams))} kg`;
}

// ---------------------------------------------------------------------------
// Burn
// ---------------------------------------------------------------------------

/** Hard ceiling on a single entry: 24 hours. Also enforced by a CHECK constraint. */
export const MAX_DURATION_MINUTES = 24 * 60;

/**
 * Calories burned for one activity over one duration.
 *
 * This is deliberately the flat published rate for the activity, prorated by
 * time, and nothing else. The profile collected during onboarding is *not*
 * applied: a personalised figure would need a real formula (Mifflin–St Jeor for
 * BMR, METs per activity) and presenting an invented one as a health number is
 * worse than presenting an obviously generic one. The profile is stored and
 * displayed so that swapping this function for a proper model later changes one
 * function rather than the whole feature.
 */
export function calculateBurn(caloriesPerHour: number, durationMinutes: number): number {
  return Math.round((caloriesPerHour * durationMinutes) / 60);
}

/** Splits a minute count into the hours/minutes pair the duration inputs use. */
export function splitDuration(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** "45m", "1h", "1h 30m" — never "0h 45m". */
export function formatDuration(totalMinutes: number): string {
  const { hours, minutes } = splitDuration(totalMinutes);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const ACTIVITY_LEVELS: readonly {
  value: ActivityLevel;
  label: string;
  detail: string;
}[] = [
  { value: "SEDENTARY", label: "Sedentary", detail: "Little or no exercise" },
  { value: "LIGHTLY_ACTIVE", label: "Lightly Active", detail: "Exercise 1–3 days/week" },
  { value: "MODERATELY_ACTIVE", label: "Moderately Active", detail: "Exercise 3–5 days/week" },
  { value: "VERY_ACTIVE", label: "Very Active", detail: "Exercise 6–7 days/week" },
  {
    value: "EXTREMELY_ACTIVE",
    label: "Extremely Active",
    detail: "Intense physical activity/training",
  },
];

export const SEXES: readonly { value: Sex; label: string }[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
];

/** What someone's week is mostly built around. */
export const LIFE_CONTEXTS: readonly {
  value: LifeContext;
  label: string;
  detail: string;
  /** Icon key, resolved to a component in the UI. */
  icon: string;
}[] = [
  { value: "STUDENT", label: "Studying", detail: "School or university", icon: "study" },
  { value: "PROFESSIONAL", label: "Working", detail: "A job most weekdays", icon: "work" },
  { value: "STUDENT_AND_WORKING", label: "Both", detail: "Studying and working", icon: "both" },
  { value: "OTHER", label: "Something else", detail: "None of the above", icon: "other" },
];

export const PRIMARY_GOALS: readonly {
  value: PrimaryGoal;
  label: string;
  detail: string;
  icon: string;
}[] = [
  { value: "LOSE_WEIGHT", label: "Lose weight", detail: "Steady cardio, sustainable pace", icon: "scale" },
  { value: "BUILD_STRENGTH", label: "Build strength", detail: "Lifting, with room to recover", icon: "strength" },
  { value: "IMPROVE_ENDURANCE", label: "Improve endurance", detail: "Go further without stopping", icon: "heart" },
  { value: "STAY_HEALTHY", label: "Stay healthy", detail: "Keep moving, feel better", icon: "healthy" },
];

export function activityLevelLabel(level: ActivityLevel): string {
  return ACTIVITY_LEVELS.find((l) => l.value === level)?.label ?? "Active";
}

export function lifeContextLabel(context: LifeContext): string {
  return LIFE_CONTEXTS.find((c) => c.value === context)?.label ?? "Something else";
}

export function primaryGoalLabel(goal: PrimaryGoal): string {
  return PRIMARY_GOALS.find((g) => g.value === goal)?.label ?? "Stay healthy";
}

/**
 * Time-of-day greeting, for the header that welcomes someone back.
 *
 * Takes the hour rather than a Date because "morning" is a fact about the
 * user's wall clock, not the server's — the caller resolves the zone.
 */
export function greetingForHour(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  // Evening ends at 21, not 22. Ten at night being greeted as "evening" is the
  // kind of small wrongness that makes an app feel like it is not paying
  // attention.
  if (hour < 21) return "Good evening";
  return "Good night";
}
