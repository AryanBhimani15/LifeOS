import type { ActivityLevel, LifeContext, PrimaryGoal } from "@/generated/prisma/enums";

/**
 * Turns the onboarding answers into a weekly plan.
 *
 * This is the module that makes asking the questions worth anything. Before it
 * existed, setup collected a height, a weight and a goal and then showed a
 * calculator that ignored all three — which is a good reason for a user to
 * wonder why they were asked.
 *
 * Everything here is pure and table-driven: no database, no dates, no calls to
 * anything. That is deliberate, because "what should a lightly-active student
 * who wants to build strength be asked to do on a Tuesday" is a product
 * decision, and product decisions should be readable in one place and
 * checkable by a test rather than scattered through a repository.
 *
 * It is not a coaching algorithm and does not pretend to be one. It is a
 * sensible, conservative starting week that the user can then change.
 */

// ---------------------------------------------------------------------------
// How often
// ---------------------------------------------------------------------------

/**
 * Sessions per week, from what someone said they already do.
 *
 * Deliberately anchored to their current level rather than to their goal. A
 * plan that tells a sedentary beginner to train six times because they want to
 * lose weight is the plan they abandon in week two.
 */
const DAYS_BY_LEVEL: Record<ActivityLevel, number> = {
  SEDENTARY: 2,
  LIGHTLY_ACTIVE: 3,
  MODERATELY_ACTIVE: 4,
  VERY_ACTIVE: 5,
  EXTREMELY_ACTIVE: 6,
};

/**
 * Someone doing both a degree and a job has the least spare time of anyone
 * here, so their week is capped no matter how active they say they are. The
 * cap is a ceiling, never a promotion.
 */
const DAYS_CAP_BY_CONTEXT: Record<LifeContext, number> = {
  STUDENT: 5,
  PROFESSIONAL: 5,
  STUDENT_AND_WORKING: 4,
  OTHER: 6,
};

/** Session length in minutes, scaled to the same self-reported level. */
const MINUTES_BY_LEVEL: Record<ActivityLevel, number> = {
  SEDENTARY: 25,
  LIGHTLY_ACTIVE: 35,
  MODERATELY_ACTIVE: 45,
  VERY_ACTIVE: 55,
  EXTREMELY_ACTIVE: 65,
};

// ---------------------------------------------------------------------------
// What
// ---------------------------------------------------------------------------

interface Slot {
  /** Matches a slug in the activity catalogue. */
  slug: string;
  focus: string;
  /** Multiplier on the base session length. */
  scale: number;
}

/**
 * The rotation for each goal, in priority order.
 *
 * A plan takes the first N of these, so the shape degrades sensibly: a two-day
 * week gets the two that matter most for that goal rather than an arbitrary
 * pair. Every rotation mixes in something easy, because seven days of hard
 * sessions is how people get injured and stop.
 */
const ROTATIONS: Record<PrimaryGoal, Slot[]> = {
  LOSE_WEIGHT: [
    { slug: "walking", focus: "Easy start", scale: 1.2 },
    { slug: "cycling", focus: "Steady cardio", scale: 1 },
    { slug: "weight-training", focus: "Full body", scale: 0.9 },
    { slug: "jogging", focus: "Build the engine", scale: 1 },
    { slug: "swimming", focus: "Low impact", scale: 0.9 },
    { slug: "hiking", focus: "Long and easy", scale: 1.5 },
  ],
  BUILD_STRENGTH: [
    { slug: "weight-training", focus: "Upper body", scale: 1 },
    { slug: "weight-training", focus: "Lower body", scale: 1 },
    { slug: "walking", focus: "Active recovery", scale: 1 },
    { slug: "weight-training", focus: "Full body", scale: 1 },
    { slug: "swimming", focus: "Shoulders and back", scale: 0.8 },
    { slug: "yoga", focus: "Mobility", scale: 0.7 },
  ],
  IMPROVE_ENDURANCE: [
    { slug: "jogging", focus: "Easy miles", scale: 1 },
    { slug: "cycling", focus: "Steady state", scale: 1.2 },
    { slug: "running", focus: "Push the pace", scale: 0.8 },
    { slug: "swimming", focus: "Cross-train", scale: 0.9 },
    { slug: "jogging", focus: "Long session", scale: 1.6 },
    { slug: "yoga", focus: "Recover", scale: 0.7 },
  ],
  STAY_HEALTHY: [
    { slug: "walking", focus: "Clear your head", scale: 1.2 },
    { slug: "weight-training", focus: "Full body", scale: 0.9 },
    { slug: "yoga", focus: "Mobility", scale: 0.8 },
    { slug: "cycling", focus: "Get outside", scale: 1 },
    { slug: "swimming", focus: "Low impact", scale: 0.9 },
    { slug: "hiking", focus: "Weekend miles", scale: 1.5 },
  ],
};

const GOAL_LABEL: Record<PrimaryGoal, string> = {
  LOSE_WEIGHT: "Lean and consistent",
  BUILD_STRENGTH: "Strength block",
  IMPROVE_ENDURANCE: "Endurance build",
  STAY_HEALTHY: "Stay moving",
};

const CONTEXT_PHRASE: Record<LifeContext, string> = {
  STUDENT: "spaced around a class timetable",
  PROFESSIONAL: "spaced around a working week",
  STUDENT_AND_WORKING: "kept short, because your week is already full",
  OTHER: "spread across the week",
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface PlannedSession {
  /** 0 = Sunday, matching Date#getUTCDay. */
  dayOfWeek: number;
  slug: string;
  focus: string;
  durationMinutes: number;
  sortOrder: number;
}

export interface GeneratedPlan {
  name: string;
  daysPerWeek: number;
  rationale: string;
  sessions: PlannedSession[];
}

export interface PlanInput {
  primaryGoal: PrimaryGoal;
  activityLevel: ActivityLevel;
  lifeContext: LifeContext;
  /** 0 = Sunday. From the user's settings, so week one starts when theirs does. */
  weekStartsOn: number;
}

/**
 * Spreads N sessions across seven days with the rest days as even as possible.
 *
 * Rounding `i * 7 / n` gives 3 → days 0, 2, 5 and 4 → days 0, 2, 4, 5: gaps
 * first, and never two hard days stacked at one end of the week. Consecutive
 * days only appear once the count makes them unavoidable.
 */
export function spreadAcrossWeek(count: number, weekStartsOn: number): number[] {
  const days: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = Math.round((i * 7) / count);
    days.push((weekStartsOn + offset) % 7);
  }
  return days;
}

export function generatePlan(input: PlanInput): GeneratedPlan {
  const wanted = DAYS_BY_LEVEL[input.activityLevel];
  const daysPerWeek = Math.min(wanted, DAYS_CAP_BY_CONTEXT[input.lifeContext]);

  const baseMinutes = MINUTES_BY_LEVEL[input.activityLevel];
  const rotation = ROTATIONS[input.primaryGoal];
  const days = spreadAcrossWeek(daysPerWeek, input.weekStartsOn);

  const sessions = days.map((dayOfWeek, i) => {
    const slot = rotation[i % rotation.length];
    return {
      dayOfWeek,
      slug: slot.slug,
      focus: slot.focus,
      // Rounded to five minutes: nobody plans a 38-minute session.
      durationMinutes: Math.max(15, Math.round((baseMinutes * slot.scale) / 5) * 5),
      sortOrder: i,
    };
  });

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);

  return {
    name: GOAL_LABEL[input.primaryGoal],
    daysPerWeek,
    rationale:
      `${daysPerWeek} sessions a week, about ${Math.round(totalMinutes / 60)} hours in total, ` +
      `${CONTEXT_PHRASE[input.lifeContext]}.` +
      (wanted > daysPerWeek ? " Kept lighter than your activity level alone would suggest." : ""),
    sessions,
  };
}

// ---------------------------------------------------------------------------
// Starter goals and habits
// ---------------------------------------------------------------------------

export interface StarterGoal {
  title: string;
  description: string;
  /** Days from now. */
  targetInDays: number;
  milestones: string[];
}

const FITNESS_GOALS: Record<PrimaryGoal, StarterGoal> = {
  LOSE_WEIGHT: {
    title: "Train consistently for 12 weeks",
    description: "Consistency beats intensity. Finish the weeks, and the rest follows.",
    targetInDays: 84,
    milestones: ["Complete a full week", "Log 10 sessions", "Log 30 sessions"],
  },
  BUILD_STRENGTH: {
    title: "Build a strength base",
    description: "Three lifting sessions a week, progressing the same handful of movements.",
    targetInDays: 84,
    milestones: ["Two full weeks done", "Log 15 lifting sessions", "Add weight to every main lift"],
  },
  IMPROVE_ENDURANCE: {
    title: "Build up to an hour without stopping",
    description: "Easy miles most of the time, one harder session a week.",
    targetInDays: 90,
    milestones: ["Run 20 minutes unbroken", "Run 40 minutes unbroken", "Run an hour unbroken"],
  },
  STAY_HEALTHY: {
    title: "Move every week without fail",
    description: "No streak to protect, no target to hit — just never a blank week.",
    targetInDays: 90,
    milestones: ["Four weeks in a row", "Eight weeks in a row", "Twelve weeks in a row"],
  },
};

/**
 * A second goal drawn from the answer about their week.
 *
 * This is what stops setup from being a fitness questionnaire. Someone told us
 * they are a student; the app should have something to say about that, not just
 * about their cardio.
 */
const LIFE_GOALS: Record<LifeContext, StarterGoal> = {
  STUDENT: {
    title: "Stay ahead of coursework",
    description: "Plan the week on Sunday so no deadline arrives as a surprise.",
    targetInDays: 60,
    milestones: ["Plan a week in advance", "Finish a week with nothing overdue", "Four clear weeks"],
  },
  PROFESSIONAL: {
    title: "Protect two hours of deep work a day",
    description: "The work that matters rarely happens between meetings.",
    targetInDays: 60,
    milestones: ["Block the time for a week", "Hold it for two weeks", "Make it the default"],
  },
  STUDENT_AND_WORKING: {
    title: "Keep study and work from colliding",
    description: "One calendar, planned on Sunday, so neither side gets a surprise.",
    targetInDays: 60,
    milestones: ["Everything in one place", "A week with no clashes", "Four weeks running"],
  },
  OTHER: {
    title: "Build a weekly rhythm",
    description: "Same planning slot each week, so the rest of it has something to hang on.",
    targetInDays: 60,
    milestones: ["Plan one week", "Plan four weeks", "Plan eight weeks"],
  },
};

export function starterGoals(primaryGoal: PrimaryGoal, lifeContext: LifeContext): StarterGoal[] {
  return [FITNESS_GOALS[primaryGoal], LIFE_GOALS[lifeContext]];
}

export interface StarterHabit {
  name: string;
  description: string;
  targetPerWeek: number;
  color: string;
}

/**
 * Two habits, never more.
 *
 * A new account handed eight habits has eight things to fail at on day one.
 * Two is enough for the Today view to have something in it, and small enough
 * that keeping both is realistic.
 */
export function starterHabits(primaryGoal: PrimaryGoal, lifeContext: LifeContext): StarterHabit[] {
  const movement: StarterHabit =
    primaryGoal === "BUILD_STRENGTH"
      ? { name: "Protein with every meal", description: "Strength is built in the kitchen too.", targetPerWeek: 7, color: "#e2762c" }
      : { name: "Walk after dinner", description: "Ten minutes, no phone.", targetPerWeek: 7, color: "#10b981" };

  const focus: StarterHabit =
    lifeContext === "STUDENT" || lifeContext === "STUDENT_AND_WORKING"
      ? { name: "Review notes for 15 minutes", description: "Same time each day, before it piles up.", targetPerWeek: 5, color: "#5551ed" }
      : { name: "Plan tomorrow before you stop", description: "Five minutes at the end of the day.", targetPerWeek: 5, color: "#5551ed" };

  return [movement, focus];
}
