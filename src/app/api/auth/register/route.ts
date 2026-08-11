import { defineRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/lib/validation/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { conflict } from "@/lib/errors";
import { DEFAULT_CATEGORIES } from "@/lib/defaults";

/** Prisma reports a unique-constraint failure as P2002. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Account registration.
 *
 * Rate limited on the anonymous bucket, since there is no user to key on yet.
 * The new account's settings and default expense categories are created in the
 * same transaction as the user row, so a partial signup cannot leave an account
 * without settings.
 */
export const POST = defineRoute({
  auth: false,
  // Coarse shared bucket first, then a per-email limit once the body is parsed.
  // The shared bucket alone would let a few junk requests block all signups.
  rateLimit: RATE_LIMITS.anonymous,
  body: registerSchema,
  identityRateLimit: {
    options: RATE_LIMITS.registerIdentity,
    key: (body) => body.email,
  },
  handler: async ({ body, request }) => {
    const { name, email, password, timezone } = body;

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // The address is already visible to whoever owns it, and a vague error
      // would leave a real user unable to tell a typo from a duplicate.
      // Rate limiting is the control that makes enumeration impractical.
      throw conflict("An account with that email already exists");
    }

    const passwordHash = await hashPassword(password);

    let user: { id: string; email: string; name: string | null };
    try {
      user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            settings: { create: { timezone: timezone ?? "UTC" } },
          },
          select: { id: true, email: true, name: true },
        });

        await tx.expenseCategory.createMany({
          data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: created.id })),
        });

        return created;
      });
    } catch (error) {
      // Two concurrent signups for one address: the pre-check passes for both
      // and the unique index rejects the loser. That is a conflict, not a bug.
      if (isUniqueViolation(error)) {
        throw conflict("An account with that email already exists");
      }
      throw error;
    }

    await recordAudit({
      userId: user.id,
      action: "SIGNUP",
      summary: `Account created for ${user.email}`,
      ...requestMeta(request),
    });

    return json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  },
});
