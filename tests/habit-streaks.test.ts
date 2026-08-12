import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  bestStreak,
  cadenceLabel,
  completionRate,
  currentStreak,
  dayState,
  isAvailableOn,
  isExpectedOn,
  parseReminder,
  reminderLabel,
  streakLabel,
  weekStartOf,
  weekdayOf,
} from "@/lib/habits";
import type { Schedule } from "@/lib/habits";

/**
 * Streak rules.
 *
 * These are pure-function tests with hand-written calendars, because the rules
 * are the feature. "23 day streak" is a claim about someone's life, and the
 * ways it goes wrong — breaking on a Saturday for a weekday habit, resetting at
 * breakfast because today is not ticked yet, punishing days before the habit
 * existed — are all invisible until someone is three weeks in and furious.
 *
 * Anchor: 2026-08-12 is a Wednesday.
 */

const WED = "2026-08-12";

const daily: Schedule = {
  cadence: "DAILY",
  byWeekday: [],
  targetPerWeek: 7,
  startedOn: null,
};

/** Monday, Wednesday, Friday. */
const mwf: Schedule = {
  cadence: "SPECIFIC_DAYS",
  byWeekday: [1, 3, 5],
  targetPerWeek: 3,
  startedOn: null,
};

const thrice: Schedule = {
  cadence: "TIMES_PER_WEEK",
  byWeekday: [],
  targetPerWeek: 3,
  startedOn: null,
};

/** Days counting back from `WED`, as a set. */
const back = (...offsets: number[]) => new Set(offsets.map((n) => addDaysIso(WED, -n)));

describe("calendar arithmetic", () => {
  it("knows its weekdays", () => {
    expect(weekdayOf(WED)).toBe(3);
    expect(weekdayOf("2026-08-16")).toBe(0); // Sunday
  });

  it("starts the week where the user says it does", () => {
    expect(weekStartOf(WED, 1)).toBe("2026-08-10"); // Monday
    expect(weekStartOf(WED, 0)).toBe("2026-08-09"); // Sunday
  });
});

describe("a daily habit", () => {
  it("counts consecutive days", () => {
    expect(currentStreak(daily, back(0, 1, 2, 3), WED)).toEqual({ count: 4, unit: "day" });
  });

  /**
   * The one that matters most. Opening the app before doing today's habit must
   * not report a broken streak — the day is not over.
   */
  it("does not break just because today is not ticked yet", () => {
    expect(currentStreak(daily, back(1, 2, 3), WED)).toEqual({ count: 3, unit: "day" });
  });

  it("breaks on a missed day that has passed", () => {
    // Yesterday done, the day before missed.
    expect(currentStreak(daily, back(1, 3, 4), WED)).toEqual({ count: 1, unit: "day" });
  });

  it("is zero when nothing has been done", () => {
    expect(currentStreak(daily, new Set(), WED)).toEqual({ count: 0, unit: "day" });
  });

  /**
   * The start date stops the walk, but only because there is nothing recorded
   * before it — a blank day before the habit existed is not a miss.
   */
  it("stops walking once it runs out of history", () => {
    const started: Schedule = { ...daily, startedOn: addDaysIso(WED, -2) };
    expect(currentStreak(started, back(0, 1, 2), WED)).toEqual({ count: 3, unit: "day" });
  });

  /**
   * The other half of that rule. Someone filling in a day they forgot is
   * asserting they did it, so it counts even if it predates the start date —
   * otherwise the tracker grid would be offering a button that does nothing.
   */
  it("counts a back-filled day from before the habit was created", () => {
    const started: Schedule = { ...daily, startedOn: WED };
    expect(currentStreak(started, back(0, 1), WED)).toEqual({ count: 2, unit: "day" });
  });
});

describe("a Monday/Wednesday/Friday habit", () => {
  /**
   * The bug this feature exists to avoid: a weekday habit losing its streak
   * every weekend, on days it was never asked for.
   */
  it("survives the weekend it was never scheduled for", () => {
    // Wed (today), Mon, and the Friday before. Sat/Sun/Tue are not scheduled.
    const completed = new Set([WED, "2026-08-10", "2026-08-07"]);
    expect(currentStreak(mwf, completed, WED)).toEqual({ count: 3, unit: "day" });
  });

  it("breaks when a scheduled day is missed", () => {
    // Wednesday done, Monday skipped.
    const completed = new Set([WED, "2026-08-07"]);
    expect(currentStreak(mwf, completed, WED)).toEqual({ count: 1, unit: "day" });
  });

  it("still holds when today is a scheduled day that is not done yet", () => {
    const completed = new Set(["2026-08-10", "2026-08-07"]);
    expect(currentStreak(mwf, completed, WED)).toEqual({ count: 2, unit: "day" });
  });

  it("knows which days it is due", () => {
    expect(isExpectedOn(mwf, WED)).toBe(true); // Wednesday
    expect(isExpectedOn(mwf, "2026-08-11")).toBe(false); // Tuesday
    expect(isAvailableOn(mwf, "2026-08-11")).toBe(false);
  });
});

describe("a three-times-a-week habit", () => {
  it("is counted in weeks, not days", () => {
    // Week of Mon 10 Aug: three done. Previous week: three done.
    const completed = new Set([
      "2026-08-10", "2026-08-11", WED,
      "2026-08-03", "2026-08-05", "2026-08-07",
    ]);
    expect(currentStreak(thrice, completed, WED, 1)).toEqual({ count: 2, unit: "week" });
  });

  it("does not break mid-week when the target is not met yet", () => {
    // This week only one so far, but last week was complete.
    const completed = new Set([
      "2026-08-10",
      "2026-08-03", "2026-08-05", "2026-08-07",
    ]);
    expect(currentStreak(thrice, completed, WED, 1)).toEqual({ count: 1, unit: "week" });
  });

  it("breaks on a finished week that fell short", () => {
    const completed = new Set([
      "2026-08-10", "2026-08-11", WED,
      "2026-08-03", "2026-08-05", // only two last week
      "2026-07-27", "2026-07-29", "2026-07-31",
    ]);
    expect(currentStreak(thrice, completed, WED, 1)).toEqual({ count: 1, unit: "week" });
  });

  it("is available every day, and due on none of them", () => {
    expect(isAvailableOn(thrice, "2026-08-11")).toBe(true);
    expect(isExpectedOn(thrice, "2026-08-11")).toBe(false);
  });

  it("respects a Sunday week start", () => {
    // Sun 9th, Mon 10th, Tue 11th — one week under a Sunday start.
    const completed = new Set(["2026-08-09", "2026-08-10", "2026-08-11"]);
    expect(currentStreak(thrice, completed, WED, 0)).toEqual({ count: 1, unit: "week" });
  });
});

describe("best streak", () => {
  it("finds a longer run in the past than the one running now", () => {
    const completed = new Set([
      WED, addDaysIso(WED, -1),                      // current run: 2
      ...[5, 6, 7, 8, 9].map((n) => addDaysIso(WED, -n)), // an older run of 5
    ]);
    expect(currentStreak(daily, completed, WED)).toEqual({ count: 2, unit: "day" });
    expect(bestStreak(daily, completed, WED)).toEqual({ count: 5, unit: "day" });
  });

  it("never reports a best shorter than the current streak", () => {
    const completed = back(0, 1, 2, 3, 4);
    const now = currentStreak(daily, completed, WED);
    const best = bestStreak(daily, completed, WED);
    expect(best.count).toBeGreaterThanOrEqual(now.count);
  });

  it("is zero for a habit with no history", () => {
    expect(bestStreak(daily, new Set(), WED)).toEqual({ count: 0, unit: "day" });
  });

  it("counts weeks for a weekly-target habit", () => {
    const completed = new Set([
      "2026-08-03", "2026-08-05", "2026-08-07",
      "2026-07-27", "2026-07-29", "2026-07-31",
    ]);
    expect(bestStreak(thrice, completed, WED, 1)).toEqual({ count: 2, unit: "week" });
  });
});

describe("completion rate", () => {
  /** A perfect three-days-a-week habit is 100%, not 43%. */
  it("divides by days that were actually expected", () => {
    const completed = new Set(["2026-08-10", WED, "2026-08-07", "2026-08-05", "2026-08-03"]);
    expect(completionRate(mwf, completed, "2026-08-03", WED)).toBe(100);
  });

  it("halves when half the expected days were missed", () => {
    // Expected Mon 3, Wed 5, Fri 7, Mon 10, Wed 12 = 5 days; two done.
    const completed = new Set(["2026-08-03", "2026-08-07"]);
    expect(completionRate(mwf, completed, "2026-08-03", WED)).toBe(40);
  });

  it("ignores days before the habit began", () => {
    const started: Schedule = { ...daily, startedOn: addDaysIso(WED, -2) };
    expect(completionRate(started, back(0, 1, 2), addDaysIso(WED, -10), WED)).toBe(100);
  });

  /**
   * Not 0%, and certainly not NaN. Nothing has been asked of this habit yet,
   * and "0% kept" is a verdict rather than a fact.
   */
  it("is null, not zero, when nothing was ever due", () => {
    const future: Schedule = { ...daily, startedOn: addDaysIso(WED, 30) };
    expect(completionRate(future, new Set(), WED, WED)).toBeNull();

    // A habit scheduled only for Mondays, asked about on a Wednesday it began.
    const mondays: Schedule = { ...mwf, byWeekday: [1], startedOn: WED };
    expect(completionRate(mondays, new Set(), WED, WED)).toBeNull();
  });
});

describe("grid day states", () => {
  it("distinguishes done, missed, unscheduled and future", () => {
    const completed = new Set(["2026-08-10"]);
    expect(dayState(mwf, "2026-08-10", completed, WED)).toBe("done"); // Mon, done
    expect(dayState(mwf, "2026-08-07", completed, WED)).toBe("missed"); // Fri, not done
    expect(dayState(mwf, "2026-08-11", completed, WED)).toBe("unscheduled"); // Tue
    expect(dayState(mwf, "2026-08-14", completed, WED)).toBe("future"); // Fri next
  });

  /** Today is never drawn as a miss — the day is still going. */
  it("does not mark today as missed", () => {
    expect(dayState(daily, WED, new Set(), WED)).toBe("unscheduled");
  });

  it("marks days before the habit started as their own thing", () => {
    const started: Schedule = { ...daily, startedOn: WED };
    expect(dayState(started, "2026-08-01", new Set(), WED)).toBe("before-start");
  });
});

describe("labels", () => {
  it("describes each cadence the way a person would", () => {
    expect(cadenceLabel(daily)).toBe("Daily");
    expect(cadenceLabel(mwf)).toBe("Mon, Wed, Fri");
    expect(cadenceLabel(thrice)).toBe("3× a week");
    expect(cadenceLabel({ ...thrice, targetPerWeek: 1 })).toBe("Weekly");
    expect(cadenceLabel({ ...mwf, byWeekday: [0, 1, 2, 3, 4, 5, 6] })).toBe("Daily");
  });

  it("says days for daily habits and weeks for weekly ones", () => {
    expect(streakLabel({ count: 23, unit: "day" })).toBe("23 day streak");
    expect(streakLabel({ count: 1, unit: "week" })).toBe("1 week streak");
    expect(streakLabel({ count: 0, unit: "day" })).toBe("No streak yet");
  });

  it("round-trips a reminder time", () => {
    expect(parseReminder("07:00")).toBe(420);
    expect(reminderLabel(420)).toBe("7:00 AM");
    expect(reminderLabel(1_260)).toBe("9:00 PM");
    expect(reminderLabel(0)).toBe("12:00 AM");
    expect(reminderLabel(null)).toBeNull();
    expect(parseReminder("25:00")).toBeNull();
    expect(parseReminder("nonsense")).toBeNull();
  });
});
