import { z } from "zod";
import { emailSchema } from "./auth";
import { isoDateTime, longText } from "./common";

/** Request shapes for the native-client API. */

export const mobileLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  device: z
    .object({
      name: z.string().trim().max(100).optional(),
      installId: z.string().trim().min(8).max(64).optional(),
      platform: z.enum(["ios", "android", "web"]).optional(),
    })
    .optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(200),
});

export const registerDeviceSchema = z.object({
  /** Stable per-install id from the client, not a device serial. */
  installId: z.string().trim().min(8).max(64),
  platform: z.enum(["ios", "android", "web"]),
  /** Absent when the user has declined notification permission. */
  pushToken: z.string().trim().max(300).nullish(),
  appVersion: z.string().trim().max(40).optional(),
});

/** Compact native quick-capture input. Advanced task fields stay desktop-first. */
export const mobileQuickCaptureSchema = z.object({
  text: z.string().trim().min(1, "What do you need to do?").max(2_000),
  /** A deliberate picker choice overrides parser output; null explicitly clears it. */
  dueAt: isoDateTime.nullish(),
  dueHasTime: z.boolean().optional(),
  note: longText(2_000).nullish(),
  remindAt: isoDateTime.nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export const mobileCapturePreviewSchema = z.object({
  text: z.string().trim().min(1, "What do you need to do?").max(2_000),
});

export const mobileCalendarQuerySchema = z.object({
  /** Any real day in the target month; the repository normalizes to its first day. */
  date: z.string().date().optional(),
});

/** Server-owned filters for the compact native task list. */
export const mobileTaskListQuerySchema = z.object({
  filter: z.enum(["open", "today", "upcoming", "completed"]).default("open"),
  search: z.string().trim().max(200).default(""),
});

export const mobileTaskReminderSchema = z.object({
  /** null explicitly removes the task's first-class reminder. */
  remindAt: isoDateTime.nullable(),
});

/**
 * Execution now accepts an idempotency key.
 *
 * Duplicate *mutation* is already impossible — the plan is claimed with a
 * conditional UPDATE, so a retry finds it non-PENDING. The problem this solves
 * is different: without a key, a retry after a dropped response reports an
 * error for work that actually succeeded. With one, the stored result is
 * replayed instead.
 */
export const executePlanSchema = z.object({
  confirmed: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
});

export type MobileLoginInput = z.infer<typeof mobileLoginSchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type MobileQuickCaptureInput = z.infer<typeof mobileQuickCaptureSchema>;
export type MobileTaskListQuery = z.infer<typeof mobileTaskListQuerySchema>;
