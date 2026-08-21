import { z } from "zod";
import { timezone } from "./common";

/**
 * Validation for user settings.
 *
 * Only fields that something actually reads are here. `reducedMotion`,
 * `emailDigest` and `digestHour` exist as columns but nothing honours them, and
 * a switch that changes a row and nothing else is a fake control — they are
 * left out until something consumes them.
 */

export const palette = z.enum(["rose", "forest", "blue"]);

/** Lives here rather than with the repository so client components can name it. */
export type Palette = z.infer<typeof palette>;

/** ISO-4217, upper-cased. Not a closed list: money formatting takes any code. */
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code like INR");

export const updateSettingsSchema = z.object({
  /** The name shown in the greeting. Empty is allowed — it falls back. */
  name: z.string().trim().max(80).optional(),
  timezone: timezone.optional(),
  /** 0 = Sunday, matching everything else in this codebase. */
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  currency: currencyCode.optional(),
  palette: palette.optional(),
  aiEnabled: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
