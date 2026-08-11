import { z } from "zod";
import { idSchema, isoDate, isoDateTime, longText, timezone, title } from "./common";

export const taskStatus = z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);
export const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const recurrenceFreq = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

export const recurrenceInput = z
  .object({
    freq: recurrenceFreq,
    interval: z.number().int().min(1).max(365).default(1),
    /** 0 = Sunday. Required for WEEKLY, ignored otherwise. */
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    byMonthday: z.number().int().min(1).max(31).nullish(),
    timezone: timezone,
    /** Minutes past local midnight; 540 = 09:00 local, preserved across DST. */
    atMinutes: z.number().int().min(0).max(1439).default(540),
    startsOn: isoDate,
    until: isoDate.nullish(),
    count: z.number().int().min(1).max(500).nullish(),
  })
  .refine((r) => r.freq !== "WEEKLY" || r.byWeekday.length > 0, {
    message: "Weekly recurrence needs at least one weekday",
    path: ["byWeekday"],
  })
  .refine((r) => !(r.until && r.count), {
    message: "Use either an end date or a repeat count, not both",
    path: ["until"],
  })
  .refine((r) => !r.until || r.until >= r.startsOn, {
    message: "End date cannot be before the start date",
    path: ["until"],
  });

export const createTaskSchema = z.object({
  title: title(200),
  description: longText(10_000).nullish(),
  status: taskStatus.default("TODO"),
  priority: priority.default("MEDIUM"),
  dueAt: isoDateTime.nullish(),
  startAt: isoDateTime.nullish(),
  estimateMin: z.number().int().min(0).max(60 * 24 * 30).nullish(),
  projectId: idSchema.nullish(),
  parentId: idSchema.nullish(),
  tagIds: z.array(idSchema).max(20).default([]),
  recurrence: recurrenceInput.nullish(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .omit({ recurrence: true })
  .extend({
    /** Fractional rank for drag-and-drop; the server rebalances when gaps shrink. */
    boardOrder: z.number().finite().optional(),
  });

export const taskQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",") : undefined))
    .pipe(z.array(taskStatus).optional()),
  priority: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",") : undefined))
    .pipe(z.array(priority).optional()),
  projectId: idSchema.optional(),
  parentId: idSchema.optional(),
  tagId: idSchema.optional(),
  search: z.string().trim().max(200).optional(),
  dueBefore: z.string().datetime({ offset: true }).optional(),
  dueAfter: z.string().datetime({ offset: true }).optional(),
  /** Omit subtasks from list views by default so boards show top-level work. */
  includeSubtasks: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  sort: z.enum(["dueAt", "priority", "createdAt", "boardOrder", "title"]).default("boardOrder"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: idSchema.optional(),
});

export const reorderSchema = z.object({
  taskId: idSchema,
  status: taskStatus,
  /** Neighbours the task was dropped between; either may be absent at an edge. */
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;
export type RecurrenceInput = z.infer<typeof recurrenceInput>;
