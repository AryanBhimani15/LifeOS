"use server";

import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/lib/validation/auth";
import { recordAudit } from "@/lib/audit";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { DEFAULT_CATEGORIES } from "@/lib/defaults";

/**
 * Auth server actions.
 *
 * These duplicate the checks in /api/auth/register rather than calling it over
 * HTTP: an internal fetch to our own API would lose the request context and add
 * a network hop for no benefit. The validation, rate limiting and audit rules
 * are the same ones, imported from the same modules.
 */

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/** Prisma reports a unique-constraint failure as P2002. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/today");

  if (!email || !password) return { error: "Enter your email and password." };

  try {
    // `signIn` throws a redirect on success, which must propagate.
    await signIn("credentials", { email, password, redirectTo: safeNext(next) });
    return {};
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof AuthError) {
      // Deliberately identical for "no such user" and "wrong password" — a
      // distinct message would let anyone test which addresses are registered.
      return { error: "That email and password combination didn't work." };
    }
    throw error;
  }
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    timezone: String(formData.get("timezone") ?? "") || undefined,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const tree = parsed.error.flatten();
    return { error: "Please fix the highlighted fields.", fieldErrors: tree.fieldErrors };
  }

  const { name, email, password, timezone } = parsed.data;

  const limit = await consumeRateLimit(`register:${email}`, RATE_LIMITS.registerIdentity);
  if (!limit.allowed) {
    return { error: "Too many attempts for this address. Try again later." };
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await hashPassword(password);

  try {
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          settings: { create: { timezone: timezone ?? "UTC" } },
        },
        select: { id: true, email: true },
      });
      await tx.expenseCategory.createMany({
        data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: created.id })),
      });
      return created;
    });

    await recordAudit({
      userId: user.id,
      action: "SIGNUP",
      summary: `Account created for ${user.email}`,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "An account with that email already exists." };
    throw error;
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/today" });
    return {};
  } catch (error) {
    if (isRedirectError(error)) throw error;
    // The account exists even if auto sign-in failed; send them to log in.
    return { error: "Account created, but sign-in failed. Please log in." };
  }
}

/**
 * Only same-origin relative paths are accepted as a post-login destination.
 * An unchecked `next` parameter is an open redirect: a crafted link would send
 * a freshly authenticated user to an attacker's page.
 */
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/today";
  return next;
}
