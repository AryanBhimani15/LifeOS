/**
 * Calendar date handling for `@db.Date` columns.
 *
 * `new Date("2026-02-30T00:00:00Z")` does not throw — it rolls over to 2 March.
 * `Date.parse` accepts it too. So a regex check of `YYYY-MM-DD` is not enough:
 * an impossible date from model output or a request body would be silently
 * stored as a different, real date. These helpers reject it instead.
 */

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a date that exists in the proleptic Gregorian calendar. */
export function isRealCalendarDate(value: string): boolean {
  const match = SHAPE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const asUtc = new Date(Date.UTC(year, month - 1, day));
  // Round-tripping catches rollover: 2026-02-30 comes back as March.
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/**
 * Converts YYYY-MM-DD to midnight UTC, or null when absent.
 * Throws on a syntactically valid but non-existent date.
 */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isRealCalendarDate(value)) {
    throw new Error(`Not a real calendar date: ${value}`);
  }
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Formats a Date as YYYY-MM-DD in UTC. */
export function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
