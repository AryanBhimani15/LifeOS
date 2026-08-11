import { defineRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/lib/validation/auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { conflict } from "@/lib/errors";
import { DEFAULT_CATEGORIES } from "@/lib/defaults";

/**
 * Account registration.
 *
 * Rate limited per IP because there is no user to key on yet. Seeds the new
 * account with default settings and expense categories in the same transaction
 * as the user row, so a partial signup cannot leave an account without settings.
 */
export const POST = defineRoute({
  auth: false,
  rateLimit: RATE_LIMITS.register,
  body: registerSchema,
  handler: async ({ body, request }) => {
    const { name, email, password, timezone } = body;

    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      // The address is already visible to whoever owns it, and a generic error
      // here would leave the user unable to tell a typo from a duplicate.
      // Registration is rate limited, which is the control that matters.
      throw conflict("An account with that email already exists");
    }

    const passwordHash = await hashPassword(password);

    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          settings: {
            create: {
              timezone: timezone ?? "UTC",
            },
          },
        },
        select: { id: true, email: true, name: true },
      });

      await tx.expenseCategory.createMany({
        data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: created.id })),
      });

      return created;
    });

    const meta = requestMeta(request);
    await recordAudit({
      userId: user.id,
      action: "SIGNUP",
      summary: `Account created for ${user.email}`,
      ...meta,
    });

    return json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  },
});
