import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  addMilestone,
  createGoal,
  deleteGoal,
  deleteMilestone,
  getGoal,
  goalStats,
  headlineGoals,
  linkHabit,
  linkTask,
  listGoals,
  reorderMilestones,
  unlinkTask,
  updateGoal,
  updateMilestone,
} from "@/lib/repositories/goals";
import { deadlineLabel, formatAmount, goalPercent, progressDetail } from "@/lib/goals";
import { createGoalSchema } from "@/lib/validation/goal";
import { makeTask, makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";

/**
 * Goals.
 *
 * The tests below are mostly about one property: the percentage on screen is
 * derived from the work, and there is no second copy of it to go stale. That is
 * why almost every case checks the number *after* changing something else — a
 * task, a milestone, a link — rather than checking that a setter set a value.
 */

const listAll = { tab: "all", sort: "deadline" } as const;

beforeEach(async () => {
  await resetDatabase();
});

describe("progress is computed from one source", () => {
  const base = {
    manualPercent: 0,
    currentMilli: 0,
    targetMilli: null,
    milestonesTotal: 0,
    milestonesDone: 0,
    tasksTotal: 0,
    tasksDone: 0,
  };

  it("reads a manual percentage back unchanged", () => {
    expect(goalPercent({ ...base, progressMode: "MANUAL", manualPercent: 75 })).toBe(75);
  });

  it("divides a numeric goal by its target", () => {
    const goal = {
      ...base,
      progressMode: "NUMERIC" as const,
      currentMilli: 45_000_000,
      targetMilli: 100_000_000,
    };
    expect(goalPercent(goal)).toBe(45);
    expect(progressDetail({ ...goal, unit: "₹" })).toBe("₹45,000 of ₹1,00,000");
  });

  it("keeps fractions exact, so 3.5 of 5 km is 70% and not 69.99%", () => {
    const goal = {
      ...base,
      progressMode: "NUMERIC" as const,
      currentMilli: 3_500,
      targetMilli: 5_000,
    };
    expect(goalPercent(goal)).toBe(70);
    expect(progressDetail({ ...goal, unit: "km" })).toBe("3.5 of 5 km");
  });

  it("never exceeds 100, even when the user overshoots the target", () => {
    expect(
      goalPercent({
        ...base,
        progressMode: "NUMERIC",
        currentMilli: 14_000,
        targetMilli: 12_000,
      }),
    ).toBe(100);
  });

  /**
   * An empty source reads 0, not 100. "All zero of my milestones are done" is
   * arithmetically 100% and completely wrong to show someone.
   */
  it("reads an empty goal as 0%, not 100%", () => {
    expect(goalPercent({ ...base, progressMode: "MILESTONES" })).toBe(0);
    expect(goalPercent({ ...base, progressMode: "TASKS" })).toBe(0);
    expect(goalPercent({ ...base, progressMode: "NUMERIC", targetMilli: 0 })).toBe(0);
  });

  it("puts a currency symbol in front and a word unit after", () => {
    expect(formatAmount(1200, "₹")).toBe("₹1,200");
    expect(formatAmount(12, "books")).toBe("12 books");
    expect(formatAmount(12, null)).toBe("12");
  });
});

describe("goals", () => {
  it("stores a numeric target exactly and reports it as a percentage", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, {
      title: "Save for the trip",
      progressMode: "NUMERIC",
      targetValue: 100_000,
      currentValue: 45_000,
      unit: "₹",
    });

    const detail = await getGoal(user.id, goal.id);
    expect(detail.percent).toBe(45);
    expect(detail.targetValue).toBe(100_000);
    expect(detail.currentValue).toBe(45_000);
  });

  /**
   * BigInt columns do not survive JSON, and every one of these rows crosses
   * both the API boundary and the server-to-client boundary. This is the test
   * that fails loudly rather than at runtime in the browser.
   */
  it("returns amounts as plain numbers, so a goal can be serialised", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, {
      title: "Run further",
      progressMode: "NUMERIC",
      targetValue: 5,
      currentValue: 3.5,
      unit: "km",
    });

    const detail = await getGoal(user.id, goal.id);
    expect(() => JSON.stringify(detail)).not.toThrow();
    expect(typeof detail.targetValue).toBe("number");

    const [summary] = await listGoals(user.id, listAll);
    expect(() => JSON.stringify(summary)).not.toThrow();
    expect(summary.percent).toBe(70);
  });

  it("refuses a numeric goal with no target to divide by", () => {
    const parsed = createGoalSchema.safeParse({ title: "Read more", progressMode: "NUMERIC" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a deadline that falls before the start date", () => {
    const parsed = createGoalSchema.safeParse({
      title: "Backwards",
      startDate: "2026-06-01",
      targetDate: "2026-05-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps one person's goals entirely out of another's", async () => {
    const { alice, bob } = await makeTwoUsers();
    const goal = await createGoal(alice.id, { title: "Alice's goal", progressMode: "MANUAL" });

    await expect(getGoal(bob.id, goal.id)).rejects.toThrow(AppError);
    await expect(deleteGoal(bob.id, goal.id)).rejects.toThrow(AppError);
    expect(await listGoals(bob.id, listAll)).toHaveLength(0);
  });
});

describe("milestones", () => {
  async function goalWithMilestones(userId: string) {
    const goal = await createGoal(userId, { title: "Final year project", progressMode: "MILESTONES" });
    const a = await addMilestone(userId, goal.id, { title: "Proposal" });
    const b = await addMilestone(userId, goal.id, { title: "Implementation" });
    const c = await addMilestone(userId, goal.id, { title: "Report" });
    return { goal, a, b, c };
  }

  it("moves the goal's percentage when a milestone is completed", async () => {
    const user = await makeUser();
    const { goal, a } = await goalWithMilestones(user.id);

    expect((await getGoal(user.id, goal.id)).percent).toBe(0);
    await updateMilestone(user.id, a.id, { completed: true });
    expect((await getGoal(user.id, goal.id)).percent).toBe(33);
  });

  it("un-completing a milestone takes the progress back down", async () => {
    const user = await makeUser();
    const { goal, a } = await goalWithMilestones(user.id);

    await updateMilestone(user.id, a.id, { completed: true });
    await updateMilestone(user.id, a.id, { completed: false });
    expect((await getGoal(user.id, goal.id)).percent).toBe(0);
  });

  it("deleting the only incomplete milestone completes the goal's progress", async () => {
    const user = await makeUser();
    const { goal, a, b, c } = await goalWithMilestones(user.id);

    await updateMilestone(user.id, a.id, { completed: true });
    await deleteMilestone(user.id, b.id);
    await deleteMilestone(user.id, c.id);
    expect((await getGoal(user.id, goal.id)).percent).toBe(100);
  });

  it("reorders by rewriting the whole list", async () => {
    const user = await makeUser();
    const { goal, a, b, c } = await goalWithMilestones(user.id);

    await reorderMilestones(user.id, goal.id, [c.id, a.id, b.id]);
    const detail = await getGoal(user.id, goal.id);
    expect(detail.milestones.map((m) => m.title)).toEqual([
      "Report",
      "Proposal",
      "Implementation",
    ]);
  });

  it("refuses to reorder using a milestone from another goal", async () => {
    const user = await makeUser();
    const { goal, a } = await goalWithMilestones(user.id);
    const other = await createGoal(user.id, { title: "Other", progressMode: "MILESTONES" });
    const stranger = await addMilestone(user.id, other.id, { title: "Not yours" });

    await expect(reorderMilestones(user.id, goal.id, [a.id, stranger.id])).rejects.toThrow(
      AppError,
    );
  });

  it("will not let another user touch a milestone", async () => {
    const { alice, bob } = await makeTwoUsers();
    const { a } = await goalWithMilestones(alice.id);

    await expect(updateMilestone(bob.id, a.id, { completed: true })).rejects.toThrow(AppError);
    await expect(deleteMilestone(bob.id, a.id)).rejects.toThrow(AppError);
  });
});

describe("linked work", () => {
  it("reflects a linked task being completed, without the goal being touched", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Ship it", progressMode: "TASKS" });
    const one = await makeTask(user.id, { title: "Write the deployment section" });
    const two = await makeTask(user.id, { title: "Record the demo" });

    await linkTask(user.id, goal.id, one.id);
    await linkTask(user.id, goal.id, two.id);
    expect((await getGoal(user.id, goal.id)).percent).toBe(0);

    // Completed through the Tasks feature, exactly as the board does it.
    await db.task.update({ where: { id: one.id }, data: { status: "DONE" } });

    expect((await getGoal(user.id, goal.id)).percent).toBe(50);
  });

  it("unlinking a task leaves the task alone", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Ship it", progressMode: "TASKS" });
    const task = await makeTask(user.id, { title: "Still mine" });

    await linkTask(user.id, goal.id, task.id);
    await unlinkTask(user.id, goal.id, task.id);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.goalId).toBeNull();
    expect(after.title).toBe("Still mine");
  });

  /** Deleting a goal must never delete the work that was serving it. */
  it("deleting a goal keeps its tasks and habits, only dropping the link", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Doomed", progressMode: "TASKS" });
    const task = await makeTask(user.id, { title: "Survives" });
    const habit = await db.habit.create({ data: { userId: user.id, name: "Read" } });

    await linkTask(user.id, goal.id, task.id);
    await linkHabit(user.id, goal.id, habit.id);
    await deleteGoal(user.id, goal.id);

    const survivingTask = await db.task.findUnique({ where: { id: task.id } });
    const survivingHabit = await db.habit.findUnique({ where: { id: habit.id } });
    expect(survivingTask?.goalId).toBeNull();
    expect(survivingHabit?.goalId).toBeNull();
    expect(survivingTask?.title).toBe("Survives");
  });

  it("refuses to link a task belonging to someone else", async () => {
    const { alice, bob } = await makeTwoUsers();
    const goal = await createGoal(alice.id, { title: "Mine", progressMode: "TASKS" });
    const bobsTask = await makeTask(bob.id, { title: "Bob's" });

    await expect(linkTask(alice.id, goal.id, bobsTask.id)).rejects.toThrow(AppError);
    expect((await getGoal(alice.id, goal.id)).tasks).toHaveLength(0);
  });
});

describe("history and the summary cards", () => {
  it("records a point when the number moves, and not when it does not", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Track me", progressMode: "MANUAL" });

    await updateGoal(user.id, goal.id, { manualPercent: 20 });
    await updateGoal(user.id, goal.id, { manualPercent: 20 });
    await updateGoal(user.id, goal.id, { manualPercent: 60 });

    const detail = await getGoal(user.id, goal.id);
    expect(detail.progress.map((p) => p.percent)).toEqual([0, 20, 60]);
  });

  it("counts this month's gain from where each goal stood before the month began", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Ongoing", progressMode: "MANUAL" });

    // A point recorded last month: the goal was already at 30%.
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1, 15);
    await db.goalProgress.create({
      data: { goalId: goal.id, percent: 30, recordedAt: lastMonth },
    });

    await updateGoal(user.id, goal.id, { manualPercent: 55 });

    const stats = await goalStats(user.id);
    expect(stats.active).toBe(1);
    expect(stats.monthProgress).toBe(25);
  });

  it("separates active from completed", async () => {
    const user = await makeUser();
    const done = await createGoal(user.id, { title: "Done", progressMode: "MANUAL" });
    await createGoal(user.id, { title: "Doing", progressMode: "MANUAL" });
    await updateGoal(user.id, done.id, { status: "ACHIEVED" });

    const stats = await goalStats(user.id);
    expect(stats).toMatchObject({ active: 1, completed: 1 });
    expect(await listGoals(user.id, { ...listAll, tab: "completed" })).toHaveLength(1);
    expect(await listGoals(user.id, { ...listAll, tab: "active" })).toHaveLength(1);
  });

  it("clears the achieved date when a goal is reopened", async () => {
    const user = await makeUser();
    const goal = await createGoal(user.id, { title: "Reopened", progressMode: "MANUAL" });

    await updateGoal(user.id, goal.id, { status: "ACHIEVED" });
    expect((await getGoal(user.id, goal.id)).achievedAt).not.toBeNull();

    await updateGoal(user.id, goal.id, { status: "ACTIVE" });
    expect((await getGoal(user.id, goal.id)).achievedAt).toBeNull();
  });
});

describe("sorting and the Home card", () => {
  async function threeGoals(userId: string) {
    await createGoal(userId, { title: "Beta", progressMode: "MANUAL", manualPercent: 10, targetDate: "2026-12-01" });
    await createGoal(userId, { title: "Alpha", progressMode: "MANUAL", manualPercent: 90, targetDate: "2026-09-01" });
    await createGoal(userId, { title: "Gamma", progressMode: "MANUAL", manualPercent: 50 });
  }

  it("sorts by deadline, progress and name, and sinks undated goals", async () => {
    const user = await makeUser();
    await threeGoals(user.id);

    const byDeadline = await listGoals(user.id, { tab: "all", sort: "deadline" });
    expect(byDeadline.map((g) => g.title)).toEqual(["Alpha", "Beta", "Gamma"]);

    const byProgress = await listGoals(user.id, { tab: "all", sort: "progress" });
    expect(byProgress.map((g) => g.title)).toEqual(["Alpha", "Gamma", "Beta"]);

    const byName = await listGoals(user.id, { tab: "all", sort: "name" });
    expect(byName.map((g) => g.title)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("gives Home the nearest active goals only", async () => {
    const user = await makeUser();
    await threeGoals(user.id);
    const [first] = await listGoals(user.id, listAll);
    await updateGoal(user.id, first.id, { status: "ACHIEVED" });

    const headline = await headlineGoals(user.id, 3);
    expect(headline.map((g) => g.title)).toEqual(["Beta", "Gamma"]);
  });
});

describe("deadline wording", () => {
  const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("says today, tomorrow, overdue or a date", () => {
    expect(deadlineLabel(on("2026-08-12"), "2026-08-12")).toBe("Due today");
    expect(deadlineLabel(on("2026-08-13"), "2026-08-12")).toBe("Due tomorrow");
    expect(deadlineLabel(on("2026-08-09"), "2026-08-12")).toBe("3 days overdue");
    expect(deadlineLabel(on("2026-08-11"), "2026-08-12")).toBe("1 day overdue");
    expect(deadlineLabel(null, "2026-08-12")).toBeNull();
  });

  /**
   * A deadline is a calendar date, so the answer must not change with the
   * server's clock or the user's offset. Comparing instants gets this wrong.
   */
  it("is not thrown off by a timezone", () => {
    expect(deadlineLabel(on("2026-05-30"), "2026-05-30")).toBe("Due today");
    expect(deadlineLabel(on("2026-01-01"), "2025-12-31")).toBe("Due tomorrow");
  });
});
