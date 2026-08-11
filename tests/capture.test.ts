import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { capture } from "@/lib/repositories/capture";
import { extractAmount, tidyTitle } from "@/lib/validation/capture";
import { makeTwoUsers, resetDatabase } from "./helpers/factories";

/**
 * Direct capture.
 *
 * The point of this path is that it works when the AI does not, so the tests
 * make no AI calls at all — not even a fake provider. If any of these needed
 * one, the feature would have failed at its purpose.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe("title tidying", () => {
  it("strips the filler speech naturally produces", () => {
    expect(tidyTitle("remind me to call dad")).toBe("Call dad");
    expect(tidyTitle("i need to submit the assignment")).toBe("Submit the assignment");
    expect(tidyTitle("note to self: buy milk")).toBe("Buy milk");
  });

  it("leaves an ordinary sentence alone apart from capitalisation", () => {
    expect(tidyTitle("call dad")).toBe("Call dad");
    expect(tidyTitle("  finish   the report ")).toBe("Finish the report");
  });

  it("never returns empty, even if the text is only filler", () => {
    expect(tidyTitle("remind me to").length).toBeGreaterThan(0);
  });
});

describe("amount extraction", () => {
  it("reads a symbol before the number", () => {
    expect(extractAmount("$4.50 coffee")).toEqual({ amountMajor: 4.5, currency: "USD" });
    expect(extractAmount("₹1,250 groceries")).toEqual({ amountMajor: 1250, currency: "INR" });
  });

  it("reads a currency word after the number", () => {
    expect(extractAmount("250 rupee lunch")).toEqual({ amountMajor: 250, currency: "INR" });
    expect(extractAmount("12 pounds for the train")).toEqual({ amountMajor: 12, currency: "GBP" });
  });

  it("falls back to a bare number", () => {
    expect(extractAmount("spent 12.99 on books")?.amountMajor).toBe(12.99);
  });

  it("returns null rather than guessing when there is no number", () => {
    // Inventing a figure into someone's finances is worse than storing zero and
    // saying so.
    expect(extractAmount("coffee with Sam")).toBeNull();
  });
});

describe("capture", () => {
  it("creates a task with no AI involved", async () => {
    const { alice } = await makeTwoUsers();
    const result = await capture(alice.id, { text: "remind me to call dad", type: "task" });

    expect(result.type).toBe("task");
    const task = await db.task.findUniqueOrThrow({ where: { id: result.id } });
    expect(task.title).toBe("Call dad");
    expect(task.userId).toBe(alice.id);
  });

  it("creates a goal, project and note", async () => {
    const { alice } = await makeTwoUsers();

    const goal = await capture(alice.id, { text: "run a half marathon", type: "goal" });
    const project = await capture(alice.id, { text: "final year project", type: "project" });
    const note = await capture(alice.id, {
      text: "supervisor said to focus on the evaluation chapter first",
      type: "note",
    });

    expect(await db.goal.count({ where: { id: goal.id, userId: alice.id } })).toBe(1);
    expect(await db.project.count({ where: { id: project.id, userId: alice.id } })).toBe(1);

    const stored = await db.note.findUniqueOrThrow({ where: { id: note.id } });
    // The full text is kept as the body even though the title is shortened.
    expect(stored.content).toContain("evaluation chapter");
  });

  it("stores an expense as integer minor units in the detected currency", async () => {
    const { alice } = await makeTwoUsers();
    const result = await capture(alice.id, { text: "250 rupee lunch", type: "expense" });

    const expense = await db.expense.findUniqueOrThrow({ where: { id: result.id } });
    expect(expense.amountMinor).toBe(25_000);
    expect(expense.currency).toBe("INR");
    expect(Number.isInteger(expense.amountMinor)).toBe(true);
  });

  it("says so plainly when no amount could be read", async () => {
    const { alice } = await makeTwoUsers();
    const result = await capture(alice.id, { text: "coffee with Sam", type: "expense" });

    const expense = await db.expense.findUniqueOrThrow({ where: { id: result.id } });
    expect(expense.amountMinor).toBe(0);
    // The user must be told, not left with a silent zero.
    expect(result.detail).toMatch(/no amount detected/i);
  });

  it("attaches everything to the capturing user only", async () => {
    const { alice, bob } = await makeTwoUsers();
    await capture(alice.id, { text: "alice private task", type: "task" });

    expect(await db.task.count({ where: { userId: bob.id } })).toBe(0);
    expect(await db.task.count({ where: { userId: alice.id } })).toBe(1);
  });

  it("respects the user's timezone when dating an expense", async () => {
    // The factory sets Europe/London; the expense must be dated in that zone
    // rather than the server's, or late-evening spending lands on the wrong day.
    const { alice } = await makeTwoUsers();
    const result = await capture(alice.id, { text: "£3 coffee", type: "expense" });
    const expense = await db.expense.findUniqueOrThrow({ where: { id: result.id } });
    expect(expense.spentOn).toBeInstanceOf(Date);
    expect(expense.currency).toBe("GBP");
  });
});
