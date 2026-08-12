import { addCalendarDays, instantInZone, todayInZone } from "@/lib/dates";

/**
 * Pulls a date and time out of something the user typed.
 *
 * The whole point of this module is that it is a set of regular expressions and
 * not a language model. Three reasons, in order of importance:
 *
 *  1. **It cannot invent.** An LLM asked to "extract the date" from "call dad"
 *     will, often enough to matter, decide that means today. A regex that finds
 *     no date returns no date, every time. The rule for this feature is that
 *     unspecified stays unspecified, and only a deterministic parser can
 *     actually promise that.
 *
 *  2. It is instant and free, and capture must work when the AI is rate
 *     limited, out of quota, or switched off — the same reasoning that already
 *     applies to `extractAmount` in validation/capture.ts.
 *
 *  3. It is testable. Every phrase below has a test asserting exactly what it
 *     produces, which is not a thing you can write against a model.
 *
 * The hardest case it has to get right is a *negative* one:
 *
 *     "teacher said CIA focuses on normalization"
 *
 * A naive `on (\w+)` rule turns "on normalization" into a date. Every pattern
 * here therefore requires real date evidence — a month name with a number, a
 * weekday, an ordinal — never just "on" followed by a word.
 */

export interface ParsedCapture {
  /** The text with any date/time phrase removed, tidied. Never empty. */
  title: string;
  /** Null when the user did not give a date. Never guessed. */
  dueAt: Date | null;
  /** True only when a clock time was actually written. */
  dueHasTime: boolean;
  /** The phrase that was consumed, so the UI can show what it understood. */
  matchedText: string | null;
}

export interface ParseOptions {
  now?: Date;
  timeZone?: string;
  /** 0 = Sunday. Decides where "this week" ends. */
  weekStartsOn?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

/** A hit: the calendar date it resolves to, and the slice of text it consumed. */
interface DateHit {
  date: string;
  text: string;
  index: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Weekday index of a YYYY-MM-DD date, zone-free. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The next occurrence of a weekday, today counting only when `includeToday`. */
function nextWeekday(from: string, weekday: number, includeToday: boolean): string {
  const current = weekdayOf(from);
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addCalendarDays(from, delta);
}

/**
 * Resolves a month/day pair to a calendar date.
 *
 * A month that has already passed this year means next year — someone typing
 * "January 5" in November means the coming January, not one ten months gone.
 */
function monthDayToDate(today: string, month: number, day: number, explicitYear?: number): string | null {
  const [thisYear] = today.split("-").map(Number) as [number];
  const year = explicitYear ?? thisYear;

  // Reject impossible days outright rather than letting Date roll them over.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;

  const candidate = `${year}-${pad(month)}-${pad(day)}`;
  if (explicitYear !== undefined || candidate >= today) return candidate;
  return `${year + 1}-${pad(month)}-${pad(day)}`;
}

/**
 * Finds a date phrase, or returns null.
 *
 * Patterns are tried in order of specificity: an explicit calendar date beats a
 * relative word, so "next Friday the 12th" resolves by the date rather than by
 * the weekday.
 */
function findDate(text: string, today: string, weekStartsOn: number): DateHit | null {
  const hit = (match: RegExpMatchArray, date: string | null): DateHit | null =>
    date === null ? null : { date, text: match[0], index: match.index ?? 0 };

  // --- Explicit calendar dates -------------------------------------------

  // "on September 11", "Sept 11th", "September 11 2026"
  let m = text.match(
    new RegExp(`\\b(?:on\\s+)?(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"),
  );
  if (m) {
    return hit(m, monthDayToDate(today, MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : undefined));
  }

  // "11 September", "11th of September", "11 Sept 2026"
  m = text.match(
    new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{4}))?\\b`, "i"),
  );
  if (m) {
    return hit(m, monthDayToDate(today, MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : undefined));
  }

  // "on 11/9", "11-09-2026". Day-first, matching how the rest of the app
  // formats dates; a bare "3/4" is genuinely ambiguous and this at least makes
  // it consistent rather than arbitrary.
  m = text.match(/\b(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) {
      return hit(m, monthDayToDate(today, month, Number(m[1]), year));
    }
  }

  // --- Relative phrases ---------------------------------------------------

  m = text.match(/\bday after tomorrow\b/i);
  if (m) return hit(m, addCalendarDays(today, 2));

  m = text.match(/\b(tomorrow|tmr|tmrw)\b/i);
  if (m) return hit(m, addCalendarDays(today, 1));

  m = text.match(/\b(today|tonight|this evening|this afternoon|this morning)\b/i);
  if (m) return hit(m, today);

  // "this weekend" / "next weekend" — the coming Saturday.
  m = text.match(/\b(this|next)?\s*weekend\b/i);
  if (m) {
    const saturday = nextWeekday(today, 6, false);
    return hit(m, /next/i.test(m[1] ?? "") ? addCalendarDays(saturday, 7) : saturday);
  }

  // "this week" — the last day of the current week, so it is a deadline rather
  // than a specific day.
  m = text.match(/\bthis week\b/i);
  if (m) {
    const lastDay = (weekStartsOn + 6) % 7;
    return hit(m, nextWeekday(today, lastDay, true));
  }

  m = text.match(/\bnext week\b/i);
  if (m) return hit(m, addCalendarDays(nextWeekday(today, weekStartsOn, false), 0));

  // "next month" — the same day number, one month on, clamped to a real date.
  m = text.match(/\bnext month\b/i);
  if (m) {
    const [y, mo, d] = today.split("-").map(Number) as [number, number, number];
    const targetMonth = mo === 12 ? 1 : mo + 1;
    const targetYear = mo === 12 ? y + 1 : y;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return hit(m, `${targetYear}-${pad(targetMonth)}-${pad(Math.min(d, lastDay))}`);
  }

  // "on Friday", "next Friday", "this Friday"
  m = text.match(new RegExp(`\\b(?:(next|this)\\s+)?(?:on\\s+)?(${WEEKDAY_NAMES})\\b`, "i"));
  if (m) {
    const weekday = WEEKDAYS[m[2].toLowerCase()];
    const base = nextWeekday(today, weekday, /this/i.test(m[1] ?? ""));
    return hit(m, /next/i.test(m[1] ?? "") ? addCalendarDays(base, 7) : base);
  }

  return null;
}

/** Minutes past local midnight, and the text consumed. */
interface TimeHit {
  minutes: number;
  text: string;
}

/**
 * Finds a clock time.
 *
 * A bare hour ("at 6") is disambiguated rather than invented: the time is
 * plainly there, only the half of the day is unstated. Evening is assumed for
 * 1–7 because that is overwhelmingly what people mean, and the result is shown
 * back so a wrong guess is visible and one tap from being fixed.
 */
function findTime(text: string): TimeHit | null {
  // Every number is considered, not just the first. "submit CIA 2 at 10am"
  // has to skip past the "2" — stopping at the first number found meant the
  // real time was never reached and "at 10am" was left sitting in the title.
  const pattern = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi;

  for (const m of text.matchAll(pattern)) {
    const hasMeridiem = Boolean(m[3]);
    const hasMinutes = m[2] !== undefined;
    const saidAt = /^at\s/i.test(m[0]);

    // A number on its own is not a time. "CIA 2" and "buy 3 shirts" must not
    // become 2am and 3am, so something has to mark it: "at", a meridiem, or a
    // colon.
    if (!hasMeridiem && !hasMinutes && !saidAt) continue;

    let hour = Number(m[1]);
    const minutes = hasMinutes ? Number(m[2]) : 0;
    if (hour > 23 || minutes > 59) continue;

    if (hasMeridiem) {
      const isPm = /^p/i.test(m[3]!);
      if (hour === 12) hour = isPm ? 12 : 0;
      else if (isPm) hour += 12;
    } else if (hour >= 1 && hour <= 7) {
      hour += 12;
    }

    return { minutes: hour * 60 + minutes, text: m[0] };
  }

  return null;
}

/** Removes a consumed phrase and tidies the connective words left behind. */
function strip(text: string, phrase: string): string {
  return text.replace(phrase, " ");
}

function tidy(text: string): string {
  return text
    // Dangling connectives left where a date used to be.
    .replace(/\s+(on|at|by|due|due\s+on|due\s+by|before)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[\s,\-–—]+|[\s,\-–—]+$/g, "")
    .trim();
}

export function parseCapture(raw: string, options: ParseOptions = {}): ParsedCapture {
  const timeZone = options.timeZone ?? "UTC";
  const now = options.now ?? new Date();
  const weekStartsOn = options.weekStartsOn ?? 1;
  const today = todayInZone(timeZone, now);

  const text = raw.trim();
  let remaining = text;

  const dateHit = findDate(remaining, today, weekStartsOn);
  if (dateHit) remaining = strip(remaining, dateHit.text);

  // A time is only meaningful attached to a day. "call dad at 6" is a real
  // instruction, so an unaccompanied time attaches to today — but only when the
  // time is unambiguous enough to have been found at all.
  const timeHit = findTime(remaining);
  if (timeHit) remaining = strip(remaining, timeHit.text);

  const title = tidy(remaining) || tidy(text) || text;

  if (!dateHit && !timeHit) {
    return { title, dueAt: null, dueHasTime: false, matchedText: null };
  }

  const date = dateHit?.date ?? today;
  // A day with no time is due at the end of it, not at midnight — "Friday"
  // means by Friday, and a task due at 00:00 Friday is overdue all Thursday.
  const minutes = timeHit ? timeHit.minutes : 23 * 60 + 59;

  return {
    title,
    dueAt: instantInZone(date, minutes, timeZone),
    dueHasTime: Boolean(timeHit),
    matchedText: [dateHit?.text, timeHit?.text].filter(Boolean).join(" ").trim() || null,
  };
}
