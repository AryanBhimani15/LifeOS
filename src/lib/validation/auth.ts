import { z } from "zod";

/**
 * Password policy: length over composition rules.
 *
 * Character-class requirements push people toward "Password1!" and are worse in
 * practice than a longer minimum. 12 characters, with a cap so a multi-megabyte
 * body cannot be fed to bcrypt as a denial-of-service.
 *
 * Note bcrypt silently truncates input at 72 bytes; the 200-char cap is about
 * request size, and the truncation is not a weakness at these lengths.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200, "Password must be at most 200 characters");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email address is too long");

export const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: emailSchema,
  password: passwordSchema,
  timezone: z.string().max(64).optional(),
  /** Required only when SIGNUP_INVITE_CODE is set. See src/lib/signup.ts. */
  invite: z.string().max(200).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;
