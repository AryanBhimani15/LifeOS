import { z } from "zod";
import { idSchema, isoDate, longText, title } from "./common";
import { GOAL_ICONS, MAX_GOAL_VALUE } from "@/lib/goals";

/** Validation for goals, milestones and the links between goals and other work. */

export const goalProgressMode = z.enum(["MANUAL", "NUMERIC", "MILESTONES", "TASKS"]);
export const goalStatus = z.enum(["ACTIVE", "ACHIEVED", "PAUSED", "ABANDONED"]);
export const goalIcon = z.enum(GOAL_ICONS);

const percent = z.number().int().min(0).max(100);

/**
 * An amount in whole units, as the user types it. Converted to thousandths at
 * the repository edge, never here — validation reports on what was sent.
 */
const amount = z
  .number()
  .min(0, "Cannot be negative")
  .max(MAX_GOAL_VALUE, "That is larger than this field supports")
  .refine((n) => Number.isFinite(n), "Must be a number");

const goalFields = {
  title: title(160),
  description: longText(4_000).nullish(),
  category: z.string().trim().max(40).nullish(),
  icon: goalIcon.nullish(),
  targetDate: isoDate.nullish(),
  startDate: isoDate.nullish(),
  projectId: idSchema.nullish(),
  progressMode: goalProgressMode.default("MANUAL"),
  manualPercent: percent.optional(),
  targetValue: amount.nullish(),
  currentValue: amount.nullish(),
  unit: z.string().trim().max(12).nullish(),
  /** Existing work to attach at creation. Ids only — nothing is created here. */
  taskIds: z.array(idSchema).max(50).optional(),
  habitIds: z.array(idSchema).max(50).optional(),
};

/**
 * A NUMERIC goal without a target would render "0%" forever with no way to
 * move it, so the target is required exactly when the mode needs one. Every
 * other mode derives its own denominator and needs nothing extra.
 */
const requiresTarget = (data: { progressMode?: string; targetValue?: number | null }) =>
  data.progressMode !== "NUMERIC" || (data.targetValue != null && data.targetValue > 0);

export const createGoalSchema = z
  .object(goalFields)
  .refine(requiresTarget, {
    message: "A goal measured by a number needs a target above zero.",
    path: ["targetValue"],
  })
  .refine((g) => !g.startDate || !g.targetDate || g.startDate <= g.targetDate, {
    message: "The deadline cannot be before the start date.",
    path: ["targetDate"],
  });

export const updateGoalSchema = z
  .object({
    ...goalFields,
    title: goalFields.title.optional(),
    progressMode: goalProgressMode.optional(),
    status: goalStatus.optional(),
  })
  .refine((g) => !g.startDate || !g.targetDate || g.startDate <= g.targetDate, {
    message: "The deadline cannot be before the start date.",
    path: ["targetDate"],
  });

export const listGoalsSchema = z.object({
  tab: z.enum(["all", "active", "completed"]).default("all"),
  sort: z.enum(["deadline", "progress", "created", "name"]).default("deadline"),
});

export const createMilestoneSchema = z.object({
  title: title(160),
  targetDate: isoDate.nullish(),
});

export const updateMilestoneSchema = z.object({
  title: title(160).optional(),
  targetDate: isoDate.nullish(),
  completed: z.boolean().optional(),
});

/** Reordering sends the full ordered list, so the result cannot be half-applied. */
export const reorderMilestonesSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
});

export const linkSchema = z.object({
  taskId: idSchema.optional(),
  habitId: idSchema.optional(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type ListGoalsQuery = z.infer<typeof listGoalsSchema>;
