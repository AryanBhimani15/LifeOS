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

// ---------------------------------------------------------------------------
// Timezone-aware day boundaries
// ---------------------------------------------------------------------------

/**
 * Extracts the wall-clock date parts of an instant as seen in a given IANA zone.
 *
 * `Intl` is used rather than manual offset arithmetic because offsets change
 * with DST, and a fixed offset silently breaks twice a year.
 */
function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl renders midnight as hour 24 in some locales; normalise it.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The offset, in minutes, of `timeZone` at the given instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/**
 * The calendar date the user is currently living in, as YYYY-MM-DD.
 *
 * Storing "today" as the UTC date attributes a habit completed at 00:30 in
 * Asia/Kolkata to the previous day, which quietly breaks streaks.
 */
export function todayInZone(timeZone: string, now = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Midnight UTC of the user's current local date — the value @db.Date expects. */
export function todayDateInZone(timeZone: string, now = new Date()): Date {
  return parseCalendarDate(todayInZone(timeZone, now))!;
}

/** The instant at which the user's local day containing `instant` begins. */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const offset = zoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60_000);
}

/** The last instant of the user's local day containing `instant`. */
export function endOfDayInZone(instant: Date, timeZone: string): Date {
  const start = startOfDayInZone(instant, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
}
