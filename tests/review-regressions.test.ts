import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { FakeProvider } from "@/lib/ai/provider";
import { planCommand } from "@/lib/ai/planner";
import { executePlan } from "@/lib/ai/executor";
import { aiAction } from "@/lib/ai/actions";
import { updateTask } from "@/lib/repositories/tasks";
import { isRealCalendarDate, parseCalendarDate } from "@/lib/dates";
import { assertSafeMinorUnits, toMinorUnits } from "@/lib/money";
import { makeTask, makeTwoUsers, resetDatabase } from "./helpers/factories";

/**
 * Regression tests for defects found in independent review.
 *
 * Each test names the finding it locks down, so a future refactor that
 * reintroduces one fails here with an explanation rather than a bare assertion.
 */

const envelope = (actions: unknown[]) =>
  JSON.stringify({ summary: "Test plan", actions });

beforeEach(async () => {
  await resetDatabase();
});

describe("finding 1 — concurrent execution must not duplicate a plan", () => {
  it("executes exactly once when two requests race", async () => {
    const { alice } = await makeTwoUsers();
    const provider = new FakeProvider([envelope([{ type: "create_task", title: "Pay rent" }])]);
    const plan = await planCommand(alice.id, "add pay rent", provider);

    // Both requests pass the PENDING read; only one may claim the row.
    const results = await Promise.allSettled([
      executePlan(alice.id, plan.planId!, true),
      executePlan(alice.id, plan.planId!, true),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await db.task.count({ where: { userId: alice.id, title: "Pay rent" } })).toBe(1);
  });
});

describe("finding 2 — a failing action must roll back the whole plan", () => {
  it("creates nothing when a later action fails", async () => {
    const { alice } = await makeTwoUsers();
    const target = await makeTask(alice.id, { title: "Doomed" });

    const provider = new FakeProvider([
      envelope([
        { type: "create_task", title: "Survivor" },
        { type: "delete_task", taskRef: { query: "Doomed" } },
      ]),
    ]);
    const plan = await planCommand(alice.id, "add survivor and delete doomed", provider);

    // Someone deletes the target between planning and execution.
    await db.task.delete({ where: { id: target.id } });

    await expect(executePlan(alice.id, plan.planId!, true)).rejects.toThrow();

    // The earlier create must not survive a failed plan, or a retry duplicates it.
    expect(await db.task.count({ where: { userId: alice.id, title: "Survivor" } })).toBe(0);
  });
});

describe("finding 3 — currency drives the minor-unit exponent", () => {
  it("stores JPY without inventing two decimal places", async () => {
    const { alice } = await makeTwoUsers();
    const provider = new FakeProvider([
      envelope([
        { type: "log_expense", description: "Lunch", amount: 100, currency: "JPY" },
      ]),
    ]);
    const plan = await planCommand(alice.id, "log lunch 100 yen", provider);
    await executePlan(alice.id, plan.planId!, false);

    const expense = await db.expense.findFirstOrThrow({ where: { userId: alice.id } });
    // JPY has no minor unit: ¥100 is 100, not 10000.
    expect(expense.amountMinor).toBe(100);
    expect(expense.currency).toBe("JPY");
  });

  it("converts three-decimal currencies correctly", () => {
    expect(toMinorUnits(1.5, "BHD")).toBe(1500);
    expect(toMinorUnits(1.5, "USD")).toBe(150);
    expect(toMinorUnits(1.5, "JPY")).toBe(2); // rounds, no minor unit
  });

  it("rejects an amount that would overflow a 32-bit integer column", () => {
    expect(() => assertSafeMinorUnits(toMinorUnits(10_000_000, "BHD"))).toThrow(/out of range/i);
    expect(() => assertSafeMinorUnits(toMinorUnits(1_000, "USD"))).not.toThrow();
  });

  it("rounds rather than truncates, so cents are not silently lost", () => {
    // Math.trunc(1.15 * 100) is 114 because 1.15 is stored as 1.14999…
    expect(toMinorUnits(1.15)).toBe(115);
    expect(toMinorUnits(4.35)).toBe(435);
  });
});

describe("finding 4 — impossible calendar dates must be rejected", () => {
  it("rejects a date that does not exist", () => {
    expect(isRealCalendarDate("2026-02-30")).toBe(false);
    expect(isRealCalendarDate("2026-13-01")).toBe(false);
    expect(isRealCalendarDate("2026-00-10")).toBe(false);
    expect(isRealCalendarDate("2025-02-29")).toBe(false); // 2025 is not a leap year
    expect(isRealCalendarDate("2024-02-29")).toBe(true); // 2024 is
    expect(isRealCalendarDate("2026-08-11")).toBe(true);
  });

  it("does not let a rolled-over date reach the database", () => {
    // new Date("2026-02-30T00:00:00Z") silently becomes 2 March.
    expect(() => parseCalendarDate("2026-02-30")).toThrow(/not a real calendar date/i);
    expect(parseCalendarDate("2026-08-11")?.toISOString().slice(0, 10)).toBe("2026-08-11");
    expect(parseCalendarDate(null)).toBeNull();
  });

  it("rejects an impossible date in model output at schema validation", () => {
    const parsed = aiAction.safeParse({
      type: "complete_habit",
      habitRef: { query: "Read" },
      on: "2026-02-30",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("finding 6 — an unverified deep hierarchy must not be accepted", () => {
  it("refuses a re-parent when the ancestor chain is too deep to verify", async () => {
    const { alice } = await makeTwoUsers();

    // Build a chain deeper than the traversal budget.
    let parentId: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const task: { id: string } = await db.task.create({
        data: { userId: alice.id, title: `t${i}`, parentId },
        select: { id: true },
      });
      ids.push(task.id);
      parentId = task.id;
    }

    // Pointing the root at the deepest node would create a cycle the old
    // depth-limited walk gave up on and then allowed.
    await expect(updateTask(alice.id, ids[0]!, { parentId: ids[54]! })).rejects.toThrow(
      /deeper than|ancestor/i,
    );

    const root = await db.task.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(root.parentId).toBeNull();
  });

  it("still allows a normal shallow re-parent", async () => {
    const { alice } = await makeTwoUsers();
    const a = await makeTask(alice.id, { title: "a" });
    const b = await makeTask(alice.id, { title: "b" });

    await expect(updateTask(alice.id, b.id, { parentId: a.id })).resolves.toBeTruthy();
  });
});

describe("finding 8 — assertions must actually run", () => {
  it("fails when a foreign read unexpectedly succeeds", async () => {
    // Guards the shape of the fixed test: reject-then-inspect, never an
    // assertion that only lives inside .catch().
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id);

    let ran = false;
    const error = await import("@/lib/repositories/tasks")
      .then((m) => m.getTask(bob.id, task.id))
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (e: unknown) => {
          ran = true;
          return e;
        },
      );

    expect(ran).toBe(true);
    expect(error).toBeTruthy();
  });
});
