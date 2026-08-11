import { z } from "zod";
import { emailSchema } from "./auth";

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
