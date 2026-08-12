import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { generatePlan, spreadAcrossWeek, starterGoals, starterHabits } from "@/lib/workout-plan";
import { completeOnboarding, getActivePlan, logPlannedSession } from "@/lib/repositories/onboarding";
import { fitnessProfileSchema } from "@/lib/validation/fitness";
import { endOfDayInZone, startOfDayInZone } from "@/lib/dates";
import { ACTIVITY_CATALOGUE } from "../prisma/activities";
import { makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";
import { AppError } from "@/lib/errors";
import type { ActivityLevel, LifeContext, PrimaryGoal } from "@/generated/prisma/enums";

/**
 * Plan generation.
 *
 * The rules here are product decisions — how hard a beginner's first week
 * should be, whether someone working and studying gets the same load as someone
 * doing one of them. They are worth pinning down in tests precisely because
 * they are judgement calls that a future edit could quietly reverse.
 */

const LEVELS: ActivityLevel[] = [
  "SEDENTARY",
  "LIGHTLY_ACTIVE",
  "MODERATELY_ACTIVE",
  "VERY_ACTIVE",
  "EXTREMELY_ACTIVE",
];
const GOALS: PrimaryGoal[] = [
  "LOSE_WEIGHT",
  "BUILD_STRENGTH",
  "IMPROVE_ENDURANCE",
  "STAY_HEALTHY",
];
const CONTEXTS: LifeContext[] = ["STUDENT", "PROFESSIONAL", "STUDENT_AND_WORKING", "OTHER"];

const profileInput = (over: Partial<Record<string, unknown>> = {}) =>
  fitnessProfileSchema.parse({
    firstName: "Aryan",
    age: 24,
    sex: "MALE",
    height: { unit: "cm", cm: 178 },
    weight: { unit: "kg", value: 72 },
    activityLevel: "MODERATELY_ACTIVE",
    lifeContext: "STUDENT",
    primaryGoal: "BUILD_STRENGTH",
    ...over,
  });

beforeEach(async () => {
  await resetDatabase();
});

describe("spreading sessions across the week", () => {
  it("puts rest days between sessions rather than stacking them", () => {
    expect(spreadAcrossWeek(2, 1)).toEqual([1, 5]);
    expect(spreadAcrossWeek(3, 1)).toEqual([1, 3, 6]);
    expect(spreadAcrossWeek(4, 1)).toEqual([1, 3, 5, 6]);
  });

  it("starts on the user's own first day of the week", () => {
    expect(spreadAcrossWeek(3, 0)[0]).toBe(0); // Sunday start
    expect(spreadAcrossWeek(3, 1)[0]).toBe(1); // Monday start
  });

  it("never repeats a day", () => {
    for (let count = 1; count <= 6; count += 1) {
      const days = spreadAcrossWeek(count, 1);
      expect(new Set(days).size).toBe(count);
    }
  });
});

describe("generated plans", () => {
  it("scales frequency with how active someone already is", () => {
    const days = LEVELS.map(
      (activityLevel) =>
        generatePlan({
          activityLevel,
          primaryGoal: "STAY_HEALTHY",
          lifeContext: "OTHER",
          weekStartsOn: 1,
        }).daysPerWeek,
    );
    // Monotonic, and a beginner is never asked for more than a couple of days.
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days[0]).toBeLessThanOrEqual(2);
  });

  it("caps someone who is both studying and working", () => {
    const busy = generatePlan({
      activityLevel: "EXTREMELY_ACTIVE",
      primaryGoal: "BUILD_STRENGTH",
      lifeContext: "STUDENT_AND_WORKING",
      weekStartsOn: 1,
    });
    const free = generatePlan({
      activityLevel: "EXTREMELY_ACTIVE",
      primaryGoal: "BUILD_STRENGTH",
      lifeContext: "OTHER",
      weekStartsOn: 1,
    });

    expect(busy.daysPerWeek).toBe(4);
    expect(free.daysPerWeek).toBeGreaterThan(busy.daysPerWeek);
    // And it says so, rather than quietly giving them less.
    expect(busy.rationale).toContain("Kept lighter");
  });

  it("never invents an activity that is not in the catalogue", () => {
    const slugs = new Set(ACTIVITY_CATALOGUE.map((a) => a.slug));
    for (const primaryGoal of GOALS) {
      for (const activityLevel of LEVELS) {
        for (const lifeContext of CONTEXTS) {
          const plan = generatePlan({ primaryGoal, activityLevel, lifeContext, weekStartsOn: 1 });
          for (const session of plan.sessions) {
            expect(slugs, `${primaryGoal}/${activityLevel} used ${session.slug}`).toContain(
              session.slug,
            );
          }
        }
      }
    }
  });

  it("produces sane, round session lengths for every combination", () => {
    for (const primaryGoal of GOALS) {
      for (const activityLevel of LEVELS) {
        for (const lifeContext of CONTEXTS) {
          const plan = generatePlan({ primaryGoal, activityLevel, lifeContext, weekStartsOn: 1 });
          expect(plan.sessions.length).toBe(plan.daysPerWeek);
          for (const session of plan.sessions) {
            expect(session.durationMinutes).toBeGreaterThanOrEqual(15);
            expect(session.durationMinutes).toBeLessThanOrEqual(120);
            expect(session.durationMinutes % 5).toBe(0);
            expect(session.focus.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("builds a strength plan mostly out of lifting", () => {
    const plan = generatePlan({
      primaryGoal: "BUILD_STRENGTH",
      activityLevel: "MODERATELY_ACTIVE",
      lifeContext: "OTHER",
      weekStartsOn: 1,
    });
    const lifting = plan.sessions.filter((s) => s.slug === "weight-training").length;
    expect(lifting).toBeGreaterThanOrEqual(plan.sessions.length / 2);
  });

  it("gives every goal and context its own starter goals", () => {
    for (const primaryGoal of GOALS) {
      for (const lifeContext of CONTEXTS) {
        const goals = starterGoals(primaryGoal, lifeContext);
        expect(goals).toHaveLength(2);
        for (const goal of goals) {
          expect(goal.title.length).toBeGreaterThan(0);
          expect(goal.milestones.length).toBeGreaterThan(0);
        }
        // One about training, one about the rest of life — that is the point.
        expect(goals[0].title).not.toBe(goals[1].title);
        expect(starterHabits(primaryGoal, lifeContext)).toHaveLength(2);
      }
    }
  });
});

describe("finishing setup", () => {
  it("creates a plan, goals and habits from the answers", async () => {
    const user = await makeUser();
    const summary = await completeOnboarding(user.id, profileInput());

    expect(summary.plan).not.toBeNull();
    expect(summary.goalsCreated).toBe(2);
    expect(summary.habitsCreated).toBe(2);

    const [plans, goals, habits, milestones] = await Promise.all([
      db.workoutPlan.count({ where: { userId: user.id, archivedAt: null } }),
      db.goal.count({ where: { userId: user.id } }),
      db.habit.count({ where: { userId: user.id } }),
      db.milestone.count({ where: { goal: { userId: user.id } } }),
    ]);

    expect(plans).toBe(1);
    expect(goals).toBe(2);
    expect(habits).toBe(2);
    expect(milestones).toBeGreaterThan(0);
  });

  it("does not bolt on more goals when setup is run again", async () => {
    const user = await makeUser();
    await completeOnboarding(user.id, profileInput());
    const second = await completeOnboarding(user.id, profileInput({ firstName: "Renamed" }));

    expect(second.goalsCreated).toBe(0);
    expect(second.habitsCreated).toBe(0);
    expect(await db.goal.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.habit.count({ where: { userId: user.id } })).toBe(2);
  });

  it("leaves the plan alone when only a measurement changed", async () => {
    const user = await makeUser();
    await completeOnboarding(user.id, profileInput());
    const before = await db.workoutPlan.findFirstOrThrow({
      where: { userId: user.id, archivedAt: null },
    });

    await completeOnboarding(user.id, profileInput({ weight: { unit: "kg", value: 74 } }));

    const after = await db.workoutPlan.findFirstOrThrow({
      where: { userId: user.id, archivedAt: null },
    });
    expect(after.id).toBe(before.id);
  });

  it("rebuilds and archives the old plan when the goal changes", async () => {
    const user = await makeUser();
    await completeOnboarding(user.id, profileInput({ primaryGoal: "BUILD_STRENGTH" }));
    const before = await db.workoutPlan.findFirstOrThrow({
      where: { userId: user.id, archivedAt: null },
    });

    await completeOnboarding(user.id, profileInput({ primaryGoal: "IMPROVE_ENDURANCE" }));

    const active = await db.workoutPlan.findFirstOrThrow({
      where: { userId: user.id, archivedAt: null },
    });
    expect(active.id).not.toBe(before.id);
    expect(active.primaryGoal).toBe("IMPROVE_ENDURANCE");
    // Archived, not deleted — saved workouts point at its sessions.
    const old = await db.workoutPlan.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.archivedAt).not.toBeNull();
  });

  it("stores sessions that match the catalogue", async () => {
    const user = await makeUser();
    await completeOnboarding(user.id, profileInput());

    const sessions = await db.workoutPlanSession.findMany({
      where: { plan: { userId: user.id } },
      select: { activityName: true, caloriesPerHour: true, activityId: true, dayOfWeek: true },
    });

    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      const activity = ACTIVITY_CATALOGUE.find((a) => a.id === session.activityId);
      expect(activity).toBeDefined();
      expect(session.activityName).toBe(activity!.name);
      expect(session.caloriesPerHour).toBe(activity!.caloriesPerHour);
      expect(session.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(session.dayOfWeek).toBeLessThanOrEqual(6);
    }
  });
});

describe("logging a planned session", () => {
  async function setup() {
    const user = await makeUser();
    await completeOnboarding(user.id, profileInput());
    const session = await db.workoutPlanSession.findFirstOrThrow({
      where: { plan: { userId: user.id } },
    });
    return { user, session };
  }

  it("takes only the session id and fills in the rest", async () => {
    const { user, session } = await setup();

    const entry = await logPlannedSession(user.id, session.id);

    expect(entry.activityName).toBe(session.activityName);
    expect(entry.durationMinutes).toBe(session.durationMinutes);
    expect(entry.caloriesBurned).toBe(
      Math.round((session.caloriesPerHour * session.durationMinutes) / 60),
    );
  });

  it("cannot log someone else's planned session", async () => {
    const { session } = await setup();
    const { bob } = await makeTwoUsers();

    await expect(logPlannedSession(bob.id, session.id)).rejects.toThrow(AppError);
    expect(await db.workoutEntry.count({ where: { userId: bob.id } })).toBe(0);
  });

  it("marks the session as done for the rest of the day", async () => {
    const { user, session } = await setup();
    const zone = "Europe/London";
    const now = new Date();

    await logPlannedSession(user.id, session.id);

    const plan = await getActivePlan(
      user.id,
      zone,
      startOfDayInZone(now, zone),
      endOfDayInZone(now, zone),
    );
    const logged = plan!.sessions.find((s) => s.id === session.id);
    expect(logged?.doneToday).toBe(true);
    // Only that one.
    expect(plan!.sessions.filter((s) => s.doneToday)).toHaveLength(1);
  });

  it("does not tick off a planned session logged by hand", async () => {
    const { user, session } = await setup();
    const zone = "Europe/London";
    const now = new Date();

    // Same activity, but entered through the calculator rather than the plan.
    await db.workoutEntry.create({
      data: {
        userId: user.id,
        activityId: session.activityId,
        activityName: session.activityName,
        activityIcon: session.activityIcon,
        caloriesPerHour: session.caloriesPerHour,
        durationMinutes: session.durationMinutes,
        caloriesBurned: 100,
      },
    });

    const plan = await getActivePlan(
      user.id,
      zone,
      startOfDayInZone(now, zone),
      endOfDayInZone(now, zone),
    );
    expect(plan!.sessions.every((s) => !s.doneToday)).toBe(true);
  });
});
