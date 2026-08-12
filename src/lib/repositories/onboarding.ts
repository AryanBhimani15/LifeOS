import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { todayInZone } from "@/lib/dates";
import { calculateBurn } from "@/lib/fitness";
import { generatePlan, starterGoals, starterHabits } from "@/lib/workout-plan";
import type { FitnessProfileInput } from "@/lib/validation/fitness";
import type { ActivityLevel, LifeContext, PrimaryGoal } from "@/generated/prisma/enums";

/**
 * What finishing setup actually does.
 *
 * Saving the answers is the small part. The point of asking someone their goal,
 * their week and how active they are is that they should come out of setup with
 * a plan, a couple of goals and a Today view that is not empty — otherwise the
 * questions were a toll booth.
 *
 * All of it happens in one transaction. A half-applied setup that left a
 * profile with no plan would send the user to a dashboard that promises a
 * session and cannot name one.
 */

export interface SetupSummary {
  firstName: string;
  plan: { name: string; daysPerWeek: number; rationale: string; sessions: number } | null;
  goalsCreated: number;
  habitsCreated: number;
}

/** The answers that decide what a plan looks like. Changing one rebuilds it. */
function planInputsChanged(
  before: { primaryGoal: PrimaryGoal; activityLevel: ActivityLevel; lifeContext: LifeContext } | null,
  after: { primaryGoal: PrimaryGoal; activityLevel: ActivityLevel; lifeContext: LifeContext },
): boolean {
  if (!before) return true;
  return (
    before.primaryGoal !== after.primaryGoal ||
    before.activityLevel !== after.activityLevel ||
    before.lifeContext !== after.lifeContext
  );
}

export async function completeOnboarding(
  userId: string,
  input: FitnessProfileInput,
): Promise<SetupSummary> {
  const [settings, existing, activePlan, goalCount, habitCount, catalogue] = await Promise.all([
    db.userSettings.findUnique({
      where: { userId },
      select: { weekStartsOn: true, timezone: true },
    }),
    db.fitnessProfile.findUnique({
      where: { userId },
      select: { primaryGoal: true, activityLevel: true, lifeContext: true },
    }),
    db.workoutPlan.findFirst({
      where: { userId, archivedAt: null },
      select: { id: true },
    }),
    db.goal.count({ where: { userId } }),
    db.habit.count({ where: { userId } }),
    db.activity.findMany({
      where: { archived: false },
      select: { id: true, slug: true, name: true, icon: true, caloriesPerHour: true },
    }),
  ]);

  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const bySlug = new Map(catalogue.map((a) => [a.slug, a]));

  const profileFields = {
    firstName: input.firstName,
    age: input.age,
    sex: input.sex,
    heightMm: input.height.heightMm,
    heightUnit: input.height.heightUnit,
    weightGrams: input.weight.weightGrams,
    weightUnit: input.weight.weightUnit,
    activityLevel: input.activityLevel,
    lifeContext: input.lifeContext,
    primaryGoal: input.primaryGoal,
    completedAt: new Date(),
  };

  // Editing a weight should not silently rewrite someone's training week; only
  // the three answers a plan is derived from can do that.
  const rebuildPlan = !activePlan || planInputsChanged(existing, input);
  const plan = rebuildPlan
    ? generatePlan({
        primaryGoal: input.primaryGoal,
        activityLevel: input.activityLevel,
        lifeContext: input.lifeContext,
        weekStartsOn,
      })
    : null;

  // Only ever seeded into an empty account. Someone re-running setup after six
  // months of real goals must not find two more bolted on beside them.
  const seedGoals = goalCount === 0;
  const seedHabits = habitCount === 0;

  await db.$transaction(async (tx) => {
    await tx.fitnessProfile.upsert({
      where: { userId },
      create: { userId, ...profileFields },
      update: profileFields,
    });

    if (plan) {
      if (activePlan) {
        // Archived rather than deleted: saved workouts point at its sessions,
        // and history should keep resolving to something real.
        await tx.workoutPlan.update({
          where: { id: activePlan.id },
          data: { archivedAt: new Date() },
        });
      }

      await tx.workoutPlan.create({
        data: {
          userId,
          name: plan.name,
          primaryGoal: input.primaryGoal,
          daysPerWeek: plan.daysPerWeek,
          rationale: plan.rationale,
          sessions: {
            create: plan.sessions.flatMap((session) => {
              const activity = bySlug.get(session.slug);
              if (!activity) return [];
              return [
                {
                  dayOfWeek: session.dayOfWeek,
                  activityId: activity.id,
                  activityName: activity.name,
                  activityIcon: activity.icon,
                  caloriesPerHour: activity.caloriesPerHour,
                  durationMinutes: session.durationMinutes,
                  focus: session.focus,
                  sortOrder: session.sortOrder,
                },
              ];
            }),
          },
        },
      });
    }

    if (seedGoals) {
      for (const goal of starterGoals(input.primaryGoal, input.lifeContext)) {
        await tx.goal.create({
          data: {
            userId,
            title: goal.title,
            description: goal.description,
            targetDate: new Date(Date.now() + goal.targetInDays * 86_400_000),
            milestones: {
              create: goal.milestones.map((title, i) => ({ title, sortOrder: i })),
            },
          },
        });
      }
    }

    if (seedHabits) {
      await tx.habit.createMany({
        data: starterHabits(input.primaryGoal, input.lifeContext).map((habit) => ({
          userId,
          name: habit.name,
          description: habit.description,
          cadence: habit.cadence,
          category: habit.category,
          icon: habit.icon,
          targetPerWeek: habit.targetPerWeek,
          color: habit.color,
          // Starts today, so setup does not hand someone a habit that is
          // already showing missed days.
          startedOn: new Date(`${todayInZone(settings?.timezone ?? "UTC")}T00:00:00Z`),
        })),
      });
    }
  });

  return {
    firstName: input.firstName,
    plan: plan
      ? {
          name: plan.name,
          daysPerWeek: plan.daysPerWeek,
          rationale: plan.rationale,
          sessions: plan.sessions.length,
        }
      : null,
    goalsCreated: seedGoals ? 2 : 0,
    habitsCreated: seedHabits ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
// Reading the plan back
// ---------------------------------------------------------------------------

export interface PlanSessionView {
  id: string;
  dayOfWeek: number;
  activityName: string;
  activityIcon: string;
  caloriesPerHour: number;
  durationMinutes: number;
  focus: string;
  estimatedCalories: number;
  /** Whether this session has already been logged today. */
  doneToday: boolean;
}

export interface PlanView {
  id: string;
  name: string;
  daysPerWeek: number;
  rationale: string;
  sessions: PlanSessionView[];
  today: PlanSessionView[];
}

/**
 * The active plan, with today's sessions marked off.
 *
 * "Done today" is resolved from workout entries that point back at the session,
 * rather than by matching activity names — logging a run by hand should not tick
 * off a planned run.
 */
export async function getActivePlan(userId: string, zone: string, dayStart: Date, dayEnd: Date) {
  const plan = await db.workoutPlan.findFirst({
    where: { userId, archivedAt: null },
    select: {
      id: true,
      name: true,
      daysPerWeek: true,
      rationale: true,
      sessions: {
        select: {
          id: true,
          dayOfWeek: true,
          activityName: true,
          activityIcon: true,
          caloriesPerHour: true,
          durationMinutes: true,
          focus: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!plan) return null;

  const loggedToday = await db.workoutEntry.findMany({
    where: {
      userId,
      planSessionId: { in: plan.sessions.map((s) => s.id) },
      performedAt: { gte: dayStart, lte: dayEnd },
    },
    select: { planSessionId: true },
  });
  const done = new Set(loggedToday.map((e) => e.planSessionId));

  // The weekday of the user's local date. Taking getUTCDay of that date at UTC
  // midnight avoids reasoning about the zone twice.
  const todayIndex = new Date(`${todayInZone(zone)}T00:00:00Z`).getUTCDay();

  const sessions: PlanSessionView[] = plan.sessions.map((session) => ({
    ...session,
    estimatedCalories: calculateBurn(session.caloriesPerHour, session.durationMinutes),
    doneToday: done.has(session.id),
  }));

  const view: PlanView = {
    id: plan.id,
    name: plan.name,
    daysPerWeek: plan.daysPerWeek,
    rationale: plan.rationale,
    sessions,
    today: sessions.filter((s) => s.dayOfWeek === todayIndex),
  };
  return view;
}

/**
 * Logs a planned session in one call.
 *
 * The whole point is that it takes no input beyond "this one" — no activity to
 * pick, no duration to type. Everything comes from the plan, and the calories
 * are recomputed here rather than trusted from the client, exactly as the
 * calculator does.
 */
export async function logPlannedSession(userId: string, sessionId: string) {
  const session = await db.workoutPlanSession.findFirst({
    where: { id: sessionId, plan: { userId } },
    select: {
      id: true,
      activityId: true,
      activityName: true,
      activityIcon: true,
      caloriesPerHour: true,
      durationMinutes: true,
    },
  });
  if (!session) throw notFound("Planned session");

  return db.workoutEntry.create({
    data: {
      userId,
      planSessionId: session.id,
      activityId: session.activityId,
      activityName: session.activityName,
      activityIcon: session.activityIcon,
      caloriesPerHour: session.caloriesPerHour,
      durationMinutes: session.durationMinutes,
      caloriesBurned: calculateBurn(session.caloriesPerHour, session.durationMinutes),
    },
    select: {
      id: true,
      activityName: true,
      durationMinutes: true,
      caloriesBurned: true,
    },
  });
}
