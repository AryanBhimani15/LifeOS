import { describe, expect, it } from "vitest";
import { parseCapture } from "@/lib/nlp/parse-capture";

/**
 * Capture parsing.
 *
 * The contract is narrow and absolute: extract what is written, invent nothing.
 * Most of these tests exist to pin down the *negative* cases, because a parser
 * that finds a date in "call dad" is worse than one that finds nothing at all —
 * a missing date is one tap to add, a wrong one is a missed deadline.
 */

// A fixed Wednesday, so "Friday", "this weekend" and "next month" are checkable.
const NOW = new Date("2026-08-12T09:00:00Z");
const OPTS = { now: NOW, timeZone: "UTC", weekStartsOn: 1 };

const parse = (text: string) => parseCapture(text, OPTS);
/** The local calendar date a result lands on. */
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const timeOf = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : null);

describe("the phrases from the brief", () => {
  it("'call dad' stays a bare title", () => {
    const r = parse("call dad");
    expect(r.title).toBe("call dad");
    expect(r.dueAt).toBeNull();
    expect(r.dueHasTime).toBe(false);
  });

  it("'submit DBMS CIA 2 on September 11 at 10am' extracts both date and time", () => {
    const r = parse("submit DBMS CIA 2 on September 11 at 10am");
    expect(r.title).toBe("submit DBMS CIA 2");
    expect(dayOf(r.dueAt)).toBe("2026-09-11");
    expect(timeOf(r.dueAt)).toBe("10:00");
    expect(r.dueHasTime).toBe(true);
  });

  it("'renew domain tomorrow' takes the day and no time", () => {
    const r = parse("renew domain tomorrow");
    expect(r.title).toBe("renew domain");
    expect(dayOf(r.dueAt)).toBe("2026-08-13");
    expect(r.dueHasTime).toBe(false);
  });

  it("'buy headphones this weekend' resolves to the coming Saturday", () => {
    const r = parse("buy headphones this weekend");
    expect(r.title).toBe("buy headphones");
    expect(dayOf(r.dueAt)).toBe("2026-08-15");
    expect(r.dueHasTime).toBe(false);
  });

  it("'gym Friday at 6pm' takes the weekday and the evening time", () => {
    const r = parse("gym Friday at 6pm");
    expect(r.title).toBe("gym");
    expect(dayOf(r.dueAt)).toBe("2026-08-14");
    expect(timeOf(r.dueAt)).toBe("18:00");
    expect(r.dueHasTime).toBe(true);
  });

  /**
   * The one that matters most. "on normalization" is not a date, and a parser
   * loose enough to think it is would put a deadline on every stray "on".
   */
  it("'teacher said CIA focuses on normalization' finds nothing at all", () => {
    const r = parse("teacher said CIA focuses on normalization");
    expect(r.title).toBe("teacher said CIA focuses on normalization");
    expect(r.dueAt).toBeNull();
    expect(r.dueHasTime).toBe(false);
    expect(r.matchedText).toBeNull();
  });
});

describe("inventing nothing", () => {
  const undated = [
    "call mom",
    "buy shampoo",
    "email the supervisor about the report",
    "read chapter 4",
    "CIA 2",
    "buy 3 shirts",
    "finish the marching band arrangement",
    "we may need more time",
  ];

  it.each(undated)("leaves %j undated", (text) => {
    const r = parse(text);
    expect(r.dueAt).toBeNull();
    expect(r.dueHasTime).toBe(false);
  });

  it("never returns an empty title", () => {
    for (const text of ["tomorrow", "at 6pm", "today", "next month"]) {
      expect(parse(text).title.length).toBeGreaterThan(0);
    }
  });

  it("does not read a bare number as a time", () => {
    // "CIA 2" must not become 2am, which is what a looser time rule would do.
    expect(parse("submit CIA 2").dueAt).toBeNull();
    expect(parse("read 4 pages").dueAt).toBeNull();
  });

  /**
   * A weekday that is actually written is always taken, even when the sentence
   * makes it a noun ("sunday roast"). That is a deliberate line: the word is
   * there, so reading it is not inventing, and the UI shows the extracted date
   * with a one-tap clear. Guessing at intent instead would need exactly the
   * kind of model this parser exists to avoid.
   */
  it("takes a weekday even when it reads as a noun, and says so", () => {
    const r = parse("sunday roast recipe");
    expect(r.dueAt).not.toBeNull();
    expect(r.matchedText).toBe("sunday");
    expect(r.title).toBe("roast recipe");
  });

  it("does not treat a weekday inside a longer word as a date", () => {
    expect(parse("plan the monday-morning routine").dueAt).not.toBeNull();
    // …but a word that merely contains letters of a month is left alone.
    expect(parse("finish the augmentation doc").dueAt).toBeNull();
    expect(parse("decrement the counter").dueAt).toBeNull();
  });
});

describe("dates", () => {
  it("reads both orders of month and day", () => {
    expect(dayOf(parse("submit on September 11").dueAt)).toBe("2026-09-11");
    expect(dayOf(parse("submit 11 September").dueAt)).toBe("2026-09-11");
    expect(dayOf(parse("submit 11th of September").dueAt)).toBe("2026-09-11");
    expect(dayOf(parse("submit Sept 11").dueAt)).toBe("2026-09-11");
  });

  it("rolls a month that has already passed into next year", () => {
    // January is behind us in August, so it means the coming January.
    expect(dayOf(parse("renew on January 5").dueAt)).toBe("2027-01-05");
    // August 20 is still ahead, so it stays this year.
    expect(dayOf(parse("renew on August 20").dueAt)).toBe("2026-08-20");
  });

  it("honours an explicit year", () => {
    expect(dayOf(parse("submit September 11 2027").dueAt)).toBe("2027-09-11");
  });

  it("rejects a day that does not exist rather than rolling it over", () => {
    // 31 February must not silently become 3 March.
    expect(parse("submit on February 31").dueAt).toBeNull();
  });

  it("handles today, tomorrow and the day after", () => {
    expect(dayOf(parse("x today").dueAt)).toBe("2026-08-12");
    expect(dayOf(parse("x tomorrow").dueAt)).toBe("2026-08-13");
    expect(dayOf(parse("x day after tomorrow").dueAt)).toBe("2026-08-14");
  });

  it("handles this week and next month", () => {
    // Week starts Monday, so "this week" ends on Sunday the 16th.
    expect(dayOf(parse("finish this week").dueAt)).toBe("2026-08-16");
    expect(dayOf(parse("renew next month").dueAt)).toBe("2026-09-12");
  });

  it("takes the next occurrence of a weekday", () => {
    // Wednesday the 12th: Friday is the 14th, Tuesday is the 18th.
    expect(dayOf(parse("gym Friday").dueAt)).toBe("2026-08-14");
    expect(dayOf(parse("gym Tuesday").dueAt)).toBe("2026-08-18");
    expect(dayOf(parse("gym next Friday").dueAt)).toBe("2026-08-21");
  });

  it("prefers an explicit calendar date over a relative word", () => {
    const r = parse("submit on September 11 not tomorrow");
    expect(dayOf(r.dueAt)).toBe("2026-09-11");
  });

  it("reads day-first numeric dates", () => {
    expect(dayOf(parse("renew on 11/9").dueAt)).toBe("2026-09-11");
    expect(dayOf(parse("renew on 11-09-2027").dueAt)).toBe("2027-09-11");
  });
});

describe("times", () => {
  it("reads am and pm", () => {
    expect(timeOf(parse("call at 10am").dueAt)).toBe("10:00");
    expect(timeOf(parse("call at 10pm").dueAt)).toBe("22:00");
    expect(timeOf(parse("call at 10:30am").dueAt)).toBe("10:30");
    expect(timeOf(parse("call at 12pm").dueAt)).toBe("12:00");
    expect(timeOf(parse("call at 12am").dueAt)).toBe("00:00");
  });

  it("assumes the evening for a bare early hour", () => {
    // The time is written, only the half of the day is not — and the result is
    // shown back to the user, so a wrong reading is visible.
    expect(timeOf(parse("gym at 6").dueAt)).toBe("18:00");
    expect(timeOf(parse("standup at 9").dueAt)).toBe("09:00");
  });

  it("attaches a lone time to today", () => {
    const r = parse("call dad at 6pm");
    expect(dayOf(r.dueAt)).toBe("2026-08-12");
    expect(r.dueHasTime).toBe(true);
  });

  it("puts an untimed deadline at the end of its day, not at midnight", () => {
    // Otherwise everything due "Friday" is overdue for all of Thursday night.
    expect(timeOf(parse("submit tomorrow").dueAt)).toBe("23:59");
  });

  it("ignores an impossible clock time", () => {
    expect(parse("call at 25:00").dueAt).toBeNull();
  });
});

describe("titles", () => {
  it("removes the date phrase and the connective with it", () => {
    expect(parse("submit the report on Friday").title).toBe("submit the report");
    expect(parse("submit the report by tomorrow").title).toBe("submit the report");
    expect(parse("pay rent due on September 1").title).toBe("pay rent");
  });

  it("keeps the rest of the sentence intact", () => {
    expect(parse("email Dr Rao about the CIA 2 syllabus tomorrow").title).toBe(
      "email Dr Rao about the CIA 2 syllabus",
    );
  });

  it("reports what it consumed", () => {
    expect(parse("gym Friday at 6pm").matchedText).toBe("Friday at 6pm");
    expect(parse("call dad").matchedText).toBeNull();
  });
});

describe("timezones", () => {
  it("resolves the day in the user's zone, not the server's", () => {
    // 23:30 UTC on the 12th is already the 13th in Kolkata, so "today" differs.
    const late = new Date("2026-08-12T20:00:00Z");
    const utc = parseCapture("call dad today", { now: late, timeZone: "UTC" });
    const ist = parseCapture("call dad today", { now: late, timeZone: "Asia/Kolkata" });
    expect(dayOf(utc.dueAt)).toBe("2026-08-12");
    // Kolkata is already on the 13th at that instant.
    expect(ist.dueAt!.getTime()).toBeGreaterThan(utc.dueAt!.getTime());
  });

  it("produces the requested wall-clock time in that zone", () => {
    const r = parseCapture("call at 10am tomorrow", { now: NOW, timeZone: "Asia/Kolkata" });
    const local = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(r.dueAt!);
    expect(local).toBe("10:00");
  });
});
