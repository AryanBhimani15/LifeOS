import { z } from "zod";

/**
 * Shared primitives for request validation.
 *
 * Every field a client can send is validated server-side. Client-side checks are
 * a convenience for the user, never a control.
 */

/** cuid()-shaped ids. Rejecting malformed ids early keeps them out of queries. */
export const idSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, "Invalid id");

export const optionalId = idSchema.nullish();

/** Trimmed, length-capped free text. Caps exist so a payload cannot bloat a row. */
export const title = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const longText = (max = 20_000) => z.string().max(max);

/** Hex colour, used for tags/projects/habits. */
export const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Must be a hex colour like #6366f1");

/** ISO-8601 datetime accepted as a string and converted to Date. */
export const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

/** Calendar date (no time component), e.g. "2026-08-11". */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");

/** IANA timezone, validated against the runtime's own zone database. */
export const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

export const paginationSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Money in minor units. Never a float — see docs/decisions.md. */
export const amountMinor = z
  .number()
  .int("Amount must be a whole number of cents")
  .min(0, "Amount cannot be negative")
  .max(1_000_000_000_00, "Amount is unreasonably large");

export type Pagination = z.infer<typeof paginationSchema>;
