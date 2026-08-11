import { z } from "zod";
import { isRealCalendarDate } from "@/lib/dates";

/**
 * The validated action schema — the security boundary of the AI command centre.
 *
 * Three rules this schema exists to enforce:
 *
 *  1. The model NEVER emits SQL, Prisma calls, or field paths. It emits a closed
 *     union of named actions. Anything outside the union fails validation and is
 *     discarded before it reaches the database.
 *
 *  2. The model NEVER emits database ids. It emits *reference descriptors*
 *     ("the task called ~workout"), which the server resolves deterministically
 *     against rows the signed-in user owns. A hallucinated id cannot address
 *     another user's row because the model has no way to express an id at all.
 *
 *  3. Destructive actions are marked here, in code, not inferred from the
 *     model's own opinion of its intent. `isDestructive` is what drives the
 *     server-side confirmation requirement.
 */

/**
 * How the model refers to an existing record. `query` is matched against titles
 * server-side; the extra fields only narrow an ambiguous match.
 */
export const entityRef = z.object({
  query: z.string().trim().min(1).max(200),
  /** Optional disambiguators the model may infer from the command. */
  projectHint: z.string().trim().max(200).optional(),
  dueHint: z.string().trim().max(100).optional(),
});

export type EntityRef = z.infer<typeof entityRef>;

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);

/**
 * Absolute ISO datetime. The model is instructed to resolve relative phrases
 * ("tomorrow at 6pm") using the user's timezone, which is supplied in the
 * prompt — the server does not re-interpret natural language dates.
 */
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .refine((v) => !Number.isNaN(Date.parse(v)), "Not a real instant");
/**
 * A shape check is not enough: "2026-02-30" matches the pattern, and both
 * `new Date` and `Date.parse` roll it over to 2 March instead of rejecting it.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine(isRealCalendarDate, "That date does not exist");

export const createTaskAction = z.object({
  type: z.literal("create_task"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).optional(),
  dueAt: isoDateTime.optional(),
  priority: priority.optional(),
  projectRef: entityRef.optional(),
  tagNames: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  /** One level only. Deeper trees come from repeated commands, not one payload. */
  subtasks: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
});

export const updateTaskAction = z.object({
  type: z.literal("update_task"),
  taskRef: entityRef,
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: isoDateTime.nullable().optional(),
  priority: priority.optional(),
  status: taskStatus.optional(),
  projectRef: entityRef.optional(),
});

export const completeTaskAction = z.object({
  type: z.literal("complete_task"),
  taskRef: entityRef,
});

export const deleteTaskAction = z.object({
  type: z.literal("delete_task"),
  taskRef: entityRef,
});

export const createProjectAction = z.object({
  type: z.literal("create_project"),
  name: z.string().trim().min(1).max(150),
  description: z.string().max(5_000).optional(),
  dueDate: isoDate.optional(),
  priority: priority.optional(),
  /** Milestones created alongside the project. */
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        targetDate: isoDate.optional(),
      }),
    )
    .max(25)
    .optional(),
});

export const createEventAction = z.object({
  type: z.literal("create_event"),
  title: z.string().trim().min(1).max(200),
  startAt: isoDateTime,
  endAt: isoDateTime,
  location: z.string().max(200).optional(),
  allDay: z.boolean().optional(),
});

export const createGoalAction = z.object({
  type: z.literal("create_goal"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).optional(),
  targetDate: isoDate.optional(),
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        targetDate: isoDate.optional(),
      }),
    )
    .max(25)
    .optional(),
});

export const completeHabitAction = z.object({
  type: z.literal("complete_habit"),
  habitRef: entityRef,
  on: isoDate.optional(),
});

export const createNoteAction = z.object({
  type: z.literal("create_note"),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20_000),
  projectRef: entityRef.optional(),
});

export const logExpenseAction = z.object({
  type: z.literal("log_expense"),
  description: z.string().trim().min(1).max(200),
  /** Major units as written by the user; converted to integer minor units on execute. */
  amount: z.number().nonnegative().max(10_000_000),
  /**
   * `length(3)` alone accepts "!!!", which would be stored and then break every
   * downstream Intl.NumberFormat call. Restrict to the ISO-4217 letter shape.
   */
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code")
    .transform((c) => c.toUpperCase())
    .optional(),
  categoryName: z.string().trim().max(60).optional(),
  spentOn: isoDate.optional(),
});

/**
 * Read-only questions. These never mutate, so they skip confirmation entirely
 * and are answered from the database rather than by the model.
 */
export const queryAction = z.object({
  type: z.literal("query"),
  kind: z.enum([
    "due_this_week",
    "overdue",
    "today",
    "at_risk",
    "habit_status",
    "goal_progress",
    "spending_summary",
  ]),
  /** Free-text restatement, shown back to the user as the question understood. */
  question: z.string().trim().max(300).optional(),
});

export const aiAction = z.discriminatedUnion("type", [
  createTaskAction,
  updateTaskAction,
  completeTaskAction,
  deleteTaskAction,
  createProjectAction,
  createEventAction,
  createGoalAction,
  completeHabitAction,
  createNoteAction,
  logExpenseAction,
  queryAction,
]);

export type AiAction = z.infer<typeof aiAction>;
export type AiActionType = AiAction["type"];

/** The full envelope the model must return. */
export const aiPlanEnvelope = z.object({
  /** Plain-language restatement of what will happen, shown before confirming. */
  summary: z.string().trim().min(1).max(1_000),
  actions: z.array(aiAction).min(0).max(25),
  /**
   * Populated when the command cannot be turned into actions confidently. A
   * non-empty value blocks execution and is surfaced as a question.
   */
  clarification: z.string().trim().max(500).optional(),
});

export type AiPlanEnvelope = z.infer<typeof aiPlanEnvelope>;

/**
 * Destructive actions, declared in code.
 *
 * Deliberately not asked of the model: a prompt-injected payload could claim
 * any deletion was non-destructive. The server decides.
 */
const DESTRUCTIVE: ReadonlySet<AiActionType> = new Set(["delete_task"]);

/** Actions that change data at all — used to decide whether a plan mutates. */
const MUTATING: ReadonlySet<AiActionType> = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "create_project",
  "create_event",
  "create_goal",
  "complete_habit",
  "create_note",
  "log_expense",
]);

export const isDestructive = (action: AiAction) => DESTRUCTIVE.has(action.type);
export const isMutating = (action: AiAction) => MUTATING.has(action.type);
export const planIsDestructive = (actions: AiAction[]) => actions.some(isDestructive);
export const planMutates = (actions: AiAction[]) => actions.some(isMutating);
