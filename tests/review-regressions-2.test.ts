import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { FakeProvider } from "@/lib/ai/provider";
import { planCommand } from "@/lib/ai/planner";
import { executePlan } from "@/lib/ai/executor";
import { aiAction } from "@/lib/ai/actions";
import { answerQuery } from "@/lib/ai/queries";
import { todayInZone, startOfDayInZone } from "@/lib/dates";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { makeTwoUsers, resetDatabase } from "./helpers/factories";

/** Regressions for the second independent review round. */

const envelope = (actions: unknown[]) => JSON.stringify({ summary: "Test plan", actions });

beforeEach(async () => {
  await resetDatabase();
});

describe("round 2 finding 1 — query actions must return real data", () => {
  it("answers 'overdue' from the database, not from the model", async () => {
    const { alice } = await makeTwoUsers();
    await db.task.create({
      data: {
        userId: alice.id,
        title: "Late assignment",
        dueAt: new Date(Date.now() - 86_400_000),
      },
    });
    await db.task.create({
      data: { userId: alice.id, title: "Future thing", dueAt: new Date(Date.now() + 86_400_000) },
    });

    const provider = new FakeProvider([envelope([{ type: "query", kind: "overdue" }])]);
    const plan = await planCommand(alice.id, "what is overdue?", provider);
    const outcome = await executePlan(alice.id, plan.planId!, false);

    expect(outcome.answers).toHaveLength(1);
    expect(outcome.answers[0]!.kind).toBe("overdue");
    expect(outcome.answers[0]!.items.map((i) => i.label)).toEqual(["Late assignment"]);
  });

  it("scopes query answers to the asking user", async () => {
    const { alice, bob } = await makeTwoUsers();
    await db.task.create({
      data: { userId: alice.id, title: "Alice overdue", dueAt: new Date(Date.now() - 86_400_000) },
    });

    const answer = await answerQuery(bob.id, "overdue");
    expect(answer.items).toHaveLength(0);
  });

  it("answers spending_summary with real totals", async () => {
    const { alice } = await makeTwoUsers();
    await db.expense.createMany({
      data: [
        { userId: alice.id, description: "a", amountMinor: 1000, spentOn: new Date() },
        { userId: alice.id, description: "b", amountMinor: 2500, spentOn: new Date() },
      ],
    });

    const answer = await answerQuery(alice.id, "spending_summary");
    expect(answer.headline).toContain("35.00");
  });
});

describe("round 2 finding 2 — shared bucket must not lock out all signups", () => {
  it("does not exhaust the anonymous budget after a handful of requests", async () => {
    // The old fix used a 5/hour shared bucket, so five junk requests blocked
    // every legitimate signup on the instance.
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      const r = await consumeRateLimit("test:/api/auth/register:anonymous", RATE_LIMITS.anonymous);
      if (r.allowed) allowed += 1;
    }
    expect(allowed).toBe(20);
  });

  it("still caps repeated signups for one email address", async () => {
    const key = `test:register:id:victim-${Date.now()}@example.test`;
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      results.push((await consumeRateLimit(key, RATE_LIMITS.registerIdentity)).allowed);
    }
    expect(results.filter(Boolean)).toHaveLength(RATE_LIMITS.registerIdentity.limit);
  });
});

describe("round 2 finding 3 — 'today' must follow the user's timezone", () => {
  it("attributes a late-evening instant to the user's local date", () => {
    // 2026-08-11T19:30Z is already 2026-08-12 in Asia/Kolkata (UTC+5:30).
    const instant = new Date("2026-08-11T19:30:00Z");
    expect(todayInZone("Asia/Kolkata", instant)).toBe("2026-08-12");
    expect(todayInZone("UTC", instant)).toBe("2026-08-11");
    expect(todayInZone("America/Los_Angeles", instant)).toBe("2026-08-11");
  });

  it("computes the start of the local day correctly across a DST boundary", () => {
    // Europe/London is UTC+1 in summer, UTC+0 in winter.
    const summer = startOfDayInZone(new Date("2026-07-15T12:00:00Z"), "Europe/London");
    expect(summer.toISOString()).toBe("2026-07-14T23:00:00.000Z");

    const winter = startOfDayInZone(new Date("2026-12-15T12:00:00Z"), "Europe/London");
    expect(winter.toISOString()).toBe("2026-12-15T00:00:00.000Z");
  });

  it("records a habit completion on the user's local date", async () => {
    const { alice } = await makeTwoUsers();
    // Factory sets Europe/London.
    const habit = await db.habit.create({ data: { userId: alice.id, name: "Read" } });

    const provider = new FakeProvider([
      envelope([{ type: "complete_habit", habitRef: { query: "Read" } }]),
    ]);
    const plan = await planCommand(alice.id, "mark reading done", provider);
    await executePlan(alice.id, plan.planId!, false);

    const completion = await db.habitCompletion.findFirstOrThrow({
      where: { habitId: habit.id },
    });
    const expected = todayInZone("Europe/London");
    expect(completion.completedOn.toISOString().slice(0, 10)).toBe(expected);
  });
});

describe("round 2 finding 4 — oversized amounts fail as a bad request", () => {
  it("returns a 400-class error rather than an internal error", async () => {
    const { alice } = await makeTwoUsers();
    const provider = new FakeProvider([
      envelope([
        { type: "log_expense", description: "Huge", amount: 2_147_484, currency: "BHD" },
      ]),
    ]);
    const plan = await planCommand(alice.id, "log a huge expense", provider);

    await expect(executePlan(alice.id, plan.planId!, false)).rejects.toMatchObject({
      status: 400,
    });
    expect(await db.expense.count({ where: { userId: alice.id } })).toBe(0);
  });
});

describe("round 2 finding 5 — currency codes must be well formed", () => {
  it("rejects a non-alphabetic currency at the trust boundary", () => {
    const bad = aiAction.safeParse({
      type: "log_expense",
      description: "x",
      amount: 5,
      currency: "!!!",
    });
    expect(bad.success).toBe(false);
  });

  it("normalises a valid lowercase code to uppercase", () => {
    const ok = aiAction.safeParse({
      type: "log_expense",
      description: "x",
      amount: 5,
      currency: "jpy",
    });
    expect(ok.success).toBe(true);
    if (ok.success && ok.data.type === "log_expense") {
      expect(ok.data.currency).toBe("JPY");
    }
  });
});
