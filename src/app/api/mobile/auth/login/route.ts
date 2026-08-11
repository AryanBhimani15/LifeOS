import { defineRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { mobileLoginSchema } from "@/lib/validation/mobile";
import { issueTokens } from "@/lib/mobile-auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { unauthenticated } from "@/lib/errors";

/**
 * Exchanges email and password for a token pair.
 *
 * Mirrors the web sign-in rules exactly: same throttle per email address, same
 * constant-time comparison against a dummy hash when no user matches, same
 * deliberately identical error for "unknown email" and "wrong password". A
 * weaker mobile door would make the web hardening pointless.
 */
export const POST = defineRoute({
  auth: false,
  rateLimit: RATE_LIMITS.anonymous,
  body: mobileLoginSchema,
  identityRateLimit: {
    options: RATE_LIMITS.auth,
    key: (body) => body.email,
  },
  handler: async ({ body, request }) => {
    const { email, password, device } = body;

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Always compare, even with no user, so response timing does not reveal
    // which addresses are registered.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.passwordHash || !ok) {
      await recordAudit({
        userId: user?.id ?? null,
        action: "LOGIN_FAILED",
        summary: `Failed mobile sign-in for ${email}`,
        metadata: { client: "mobile" },
        ...requestMeta(request),
      });
      throw unauthenticated("That email and password combination didn't work.");
    }

    const tokens = await issueTokens(user.id, {
      name: device?.name,
      installId: device?.installId,
    });

    if (device?.installId && device.platform) {
      // Upsert here so a reinstall reuses its row rather than accumulating one
      // per sign-in.
      await db.device.upsert({
        where: { userId_installId: { userId: user.id, installId: device.installId } },
        create: {
          userId: user.id,
          installId: device.installId,
          platform: device.platform,
        },
        update: { lastSeenAt: new Date() },
      });
    }

    await recordAudit({
      userId: user.id,
      action: "LOGIN",
      summary: `Signed in from ${device?.name ?? "a mobile device"}`,
      metadata: { client: "mobile", platform: device?.platform },
      ...requestMeta(request),
    });

    return json({
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name },
    });
  },
});
