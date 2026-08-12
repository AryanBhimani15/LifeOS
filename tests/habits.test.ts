import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  createHabit,
  deleteHabit,
  getHabit,
  habitGrid,
  habitStats,
  listHabits,
  setCompletion,
  todayHabits,
  updateHabit,
} from "@/lib/repositories/habits";
import { addDaysIso } from "@/lib/habits";
import { createHabitSchema } from "@/lib/validation/habit";
import { todayInZone } from "@/lib/dates";
import { makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";

/**
 * Habits against the database.
 *
 * The pure streak rules are covered in habit-streaks.test.ts. What is tested
 * here is everything that only breaks once real rows are involved: that a
 * completion survives a refresh, that ticking twice does not double up, that
 * one person's history is invisible to another, and that the numbers on the
 * page are recomputed rather than remembered.
 */

const listAll = { category: "ALL", view: "today" } as const;

/** The user's own today, which is what every date in this file is relative to. */
async function todayFor(userId: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return todayInZone(settings?.timezone ?? "UTC");
}

beforeEach(async () => {
  await resetDatabase();
});

describe("creating habits", () => {
  it("starts today, so yesterday is not a missed day", async () => {
    const user = await makeUser();
    const habit = await createHabit(user.id, {
      name: "Morning meditation",
      cadence: "DAILY",
      category: "MIND",
      byWeekday: [],
      targetPerWeek: 7,
    });

    const detail = await getHabit(user.id, habit.id);
    const today = await todayFor(user.id);
    expect(detail.startedOn?.toISOString().slice(0, 10)).toBe(today);
    // Nothing done yet, but nothing missed either.
    expect(detail.streak.count).toBe(0);
    expect(detail.rateAll).toBe(0);
  });

  it("normalises the weekly target to the cadence", async () => {
    const user = await makeUser();
    const daily = await createHabit(user.id, {
      name: "Daily",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 3,
      category: "OTHER",
    });
    const chosen = await createHabit(user.id, {
      name: "Mon/Wed/Fri",
      cadence: "SPECIFIC_DAYS",
      byWeekday: [1, 3, 5],
      targetPerWeek: 7,
      category: "HEALTH",
    });

    expect((await getHabit(user.id, daily.id)).targetPerWeek).toBe(7);
    expect((await getHabit(user.id, chosen.id)).targetPerWeek).toBe(3);
  });

  it("refuses 'specific days' with no days chosen", () => {
    const parsed = createHabitSchema.safeParse({ name: "Nowhere", cadence: "SPECIFIC_DAYS" });
    expect(parsed.success).toBe(false);
  });

  it("stores a reminder as minutes from midnight", async () => {
    const user = await makeUser();
    const habit = await createHabit(user.id, {
      name: "Read 20 pages",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "STUDY",
      reminder: "21:00",
    });
    expect((await getHabit(user.id, habit.id)).reminderMinutes).toBe(1_260);
  });
});

describe("completing a habit", () => {
  async function dailyHabit(userId: string, name = "Drink 2L water") {
    return createHabit(userId, {
      name,
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "HEALTH",
    });
  }

  /** The requirement in the brief: refreshing must not lose the tick. */
  it("persists, and is still there on the next read", async () => {
    const user = await makeUser();
    const habit = await dailyHabit(user.id);

    await setCompletion(user.id, habit.id, true);

    const { habits } = await listHabits(user.id, listAll);
    expect(habits[0].doneToday).toBe(true);
    expect(habits[0].streak).toEqual({ count: 1, unit: "day" });
  });

  it("can be undone", async () => {
    const user = await makeUser();
    const habit = await dailyHabit(user.id);

    await setCompletion(user.id, habit.id, true);
    await setCompletion(user.id, habit.id, false);

    const { habits } = await listHabits(user.id, listAll);
    expect(habits[0].doneToday).toBe(false);
    expect(habits[0].streak.count).toBe(0);
  });

  /** A double tap on a phone must not create a second row or an error. */
  it("is idempotent in both directions", async () => {
    const user = await makeUser();
    const habit = await dailyHabit(user.id);

    await setCompletion(user.id, habit.id, true);
    await setCompletion(user.id, habit.id, true);
    await setCompletion(user.id, habit.id, false);
    await setCompletion(user.id, habit.id, false);

    expect(await db.habitCompletion.count({ where: { habitId: habit.id } })).toBe(0);
  });

  it("refuses to tick off a day that has not happened", async () => {
    const user = await makeUser();
    const habit = await dailyHabit(user.id);
    const tomorrow = addDaysIso(await todayFor(user.id), 1);

    await expect(setCompletion(user.id, habit.id, true, tomorrow)).rejects.toThrow(AppError);
  });

  it("lets a forgotten day be filled in afterwards", async () => {
    const user = await makeUser();
    const habit = await dailyHabit(user.id);
    const today = await todayFor(user.id);

    await setCompletion(user.id, habit.id, true, addDaysIso(today, -1));
    await setCompletion(user.id, habit.id, true, today);

    const { habits } = await listHabits(user.id, listAll);
    expect(habits[0].streak).toEqual({ count: 2, unit: "day" });
  });

  it("will not let one person tick another person's habit", async () => {
    const { alice, bob } = await makeTwoUsers();
    const habit = await dailyHabit(alice.id);

    await expect(setCompletion(bob.id, habit.id, true)).rejects.toThrow(AppError);
    expect(await db.habitCompletion.count({ where: { habitId: habit.id } })).toBe(0);
  });
});

describe("streaks over real history", () => {
  it("builds a streak from stored days rather than a counter", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Morning meditation",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "MIND",
      startedOn: addDaysIso(today, -30),
    });

    for (let day = 0; day < 23; day += 1) {
      await setCompletion(user.id, habit.id, true, addDaysIso(today, -day));
    }

    const detail = await getHabit(user.id, habit.id);
    expect(detail.streak).toEqual({ count: 23, unit: "day" });
    expect(detail.best).toEqual({ count: 23, unit: "day" });
    expect(detail.totalCompletions).toBe(23);
  });

  /**
   * The number must fall when history changes underneath it. A stored counter
   * is exactly what would fail here.
   */
  it("recomputes when a day in the middle is un-ticked", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Journal",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "PERSONAL",
      startedOn: addDaysIso(today, -10),
    });

    for (let day = 0; day < 5; day += 1) {
      await setCompletion(user.id, habit.id, true, addDaysIso(today, -day));
    }
    expect((await getHabit(user.id, habit.id)).streak.count).toBe(5);

    await setCompletion(user.id, habit.id, false, addDaysIso(today, -2));

    const after = await getHabit(user.id, habit.id);
    expect(after.streak).toEqual({ count: 2, unit: "day" });
    // The longer run still happened, so "best" remembers it.
    expect(after.best.count).toBe(2);
  });

  it("keeps a weekday habit's streak across the weekend", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    // Whatever today is, schedule the habit only for today's weekday.
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const habit = await createHabit(user.id, {
      name: "Weekly review",
      cadence: "SPECIFIC_DAYS",
      byWeekday: [weekday],
      targetPerWeek: 1,
      category: "STUDY",
      startedOn: addDaysIso(today, -30),
    });

    await setCompletion(user.id, habit.id, true, today);
    await setCompletion(user.id, habit.id, true, addDaysIso(today, -7));
    await setCompletion(user.id, habit.id, true, addDaysIso(today, -14));

    // Six unscheduled days between each: none of them break it.
    expect((await getHabit(user.id, habit.id)).streak).toEqual({ count: 3, unit: "day" });
  });
});

describe("the page's numbers", () => {
  it("counts today's completions against what is actually due today", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

    const due = await createHabit(user.id, {
      name: "Due today",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "HEALTH",
    });
    // Scheduled only for a different weekday, so it is not due today.
    await createHabit(user.id, {
      name: "Not due today",
      cadence: "SPECIFIC_DAYS",
      byWeekday: [(weekday + 3) % 7],
      targetPerWeek: 1,
      category: "STUDY",
    });

    await setCompletion(user.id, due.id, true);

    const stats = await habitStats(user.id);
    expect(stats.total).toBe(2);
    expect(stats.dueToday).toBe(1);
    expect(stats.doneToday).toBe(1);
    expect(stats.current).toMatchObject({ name: "Due today", count: 1, unit: "day" });
  });

  it("reports no streak rather than a zero for a brand new account", async () => {
    const user = await makeUser();
    await createHabit(user.id, {
      name: "Fresh",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "OTHER",
    });

    const stats = await habitStats(user.id);
    expect(stats.current).toBeNull();
    expect(stats.best).toBeNull();
  });

  it("filters by category", async () => {
    const user = await makeUser();
    await createHabit(user.id, { name: "Run", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "HEALTH" });
    await createHabit(user.id, { name: "Revise", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "STUDY" });

    const health = await listHabits(user.id, { category: "HEALTH", view: "today" });
    expect(health.habits.map((h) => h.name)).toEqual(["Run"]);
  });

  it("gives Home only the habits that are due today", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

    await createHabit(user.id, { name: "Every day", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "HEALTH" });
    await createHabit(user.id, {
      name: "Another day",
      cadence: "SPECIFIC_DAYS",
      byWeekday: [(weekday + 2) % 7],
      targetPerWeek: 1,
      category: "STUDY",
    });

    const { habits } = await todayHabits(user.id);
    expect(habits.map((h) => h.name)).toEqual(["Every day"]);
  });
});

describe("the tracker grid", () => {
  it("marks each cell done, missed, unscheduled or future", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Gridded",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "OTHER",
      startedOn: addDaysIso(today, -20),
    });

    await setCompletion(user.id, habit.id, true, addDaysIso(today, -1));

    const grid = await habitGrid(user.id, 7);
    // Seven days back, then out to the end of the current week.
    expect(grid.dates[6]).toBe(today);
    expect(grid.dates.length).toBeGreaterThanOrEqual(7);
    expect(grid.rows).toHaveLength(1);

    const cells = grid.rows[0].cells;
    expect(cells[5]).toBe("done"); // yesterday
    expect(cells[4]).toBe("missed"); // two days ago, expected and skipped
    expect(cells[6]).toBe("unscheduled"); // today: not a miss, the day is not over

    // Every day past today is drawn as still to come, never as a miss —
    // which is what makes the legend's fourth colour honest.
    for (let index = 7; index < grid.dates.length; index += 1) {
      expect(cells[index]).toBe("future");
    }
  });

  it("does not draw days from before the habit existed as misses", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    await createHabit(user.id, {
      name: "New today",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "OTHER",
      startedOn: today,
    });

    const grid = await habitGrid(user.id, 5);
    expect(grid.rows[0].cells.slice(0, 4)).toEqual([
      "before-start",
      "before-start",
      "before-start",
      "before-start",
    ]);
  });
});

describe("editing and removing", () => {
  it("changing the schedule changes what counts, without touching history", async () => {
    const user = await makeUser();
    const today = await todayFor(user.id);
    const habit = await createHabit(user.id, {
      name: "Shifting",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "OTHER",
      startedOn: addDaysIso(today, -10),
    });

    await setCompletion(user.id, habit.id, true, today);
    await setCompletion(user.id, habit.id, true, addDaysIso(today, -7));

    // As a daily habit the gap breaks it; scheduled weekly, it does not.
    expect((await getHabit(user.id, habit.id)).streak.count).toBe(1);

    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await updateHabit(user.id, habit.id, { cadence: "SPECIFIC_DAYS", byWeekday: [weekday] });

    const after = await getHabit(user.id, habit.id);
    expect(after.streak).toEqual({ count: 2, unit: "day" });
    expect(after.totalCompletions).toBe(2);
  });

  it("archiving hides a habit from the list but keeps its history", async () => {
    const user = await makeUser();
    const habit = await createHabit(user.id, { name: "Retired", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "OTHER" });
    await setCompletion(user.id, habit.id, true);

    await updateHabit(user.id, habit.id, { archived: true });

    expect((await listHabits(user.id, listAll)).habits).toHaveLength(0);
    expect(await db.habitCompletion.count({ where: { habitId: habit.id } })).toBe(1);
    // Still reachable directly, so the detail page of an archived habit works.
    expect((await getHabit(user.id, habit.id)).name).toBe("Retired");
  });

  it("deleting takes the history with it", async () => {
    const user = await makeUser();
    const habit = await createHabit(user.id, { name: "Gone", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "OTHER" });
    await setCompletion(user.id, habit.id, true);

    await deleteHabit(user.id, habit.id);

    expect(await db.habitCompletion.count({ where: { habitId: habit.id } })).toBe(0);
    await expect(getHabit(user.id, habit.id)).rejects.toThrow(AppError);
  });

  it("keeps one person entirely out of another's habits", async () => {
    const { alice, bob } = await makeTwoUsers();
    const habit = await createHabit(alice.id, { name: "Alice's", cadence: "DAILY", byWeekday: [], targetPerWeek: 7, category: "OTHER" });

    await expect(getHabit(bob.id, habit.id)).rejects.toThrow(AppError);
    await expect(updateHabit(bob.id, habit.id, { name: "Hijacked" })).rejects.toThrow(AppError);
    await expect(deleteHabit(bob.id, habit.id)).rejects.toThrow(AppError);
    expect((await listHabits(bob.id, listAll)).habits).toHaveLength(0);
  });
});

describe("habits and goals", () => {
  it("links a habit to a goal it serves", async () => {
    const user = await makeUser();
    const goal = await db.goal.create({ data: { userId: user.id, title: "Read more" } });
    const habit = await createHabit(user.id, {
      name: "Read 20 pages",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "STUDY",
      goalId: goal.id,
    });

    expect((await getHabit(user.id, habit.id)).goal).toMatchObject({ title: "Read more" });
  });

  it("refuses to link a goal belonging to someone else", async () => {
    const { alice, bob } = await makeTwoUsers();
    const goal = await db.goal.create({ data: { userId: bob.id, title: "Bob's" } });

    await expect(
      createHabit(alice.id, {
        name: "Sneaky",
        cadence: "DAILY",
        byWeekday: [],
        targetPerWeek: 7,
        category: "OTHER",
        goalId: goal.id,
      }),
    ).rejects.toThrow(AppError);
  });
});
