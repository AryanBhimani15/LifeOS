import { defineRoute, json } from "@/lib/api";
import { refreshSchema } from "@/lib/validation/mobile";
import { revokeRefreshToken } from "@/lib/mobile-auth";
import { recordAudit, requestMeta } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Signs one device out.
 *
 * Revokes only the presented refresh token, so signing out on the phone leaves
 * the browser session alone. Idempotent — signing out twice is not an error,
 * and the response is identical for an unknown token so this cannot be used to
 * test whether a token exists.
 */
export const POST = defineRoute({
  auth: false,
  rateLimit: RATE_LIMITS.anonymous,
  body: refreshSchema,
  handler: async ({ body, request, userId }) => {
    await revokeRefreshToken(body.refreshToken);
    await recordAudit({
      userId: userId || null,
      action: "LOGOUT",
      summary: "Mobile device signed out",
      metadata: { client: "mobile" },
      ...requestMeta(request),
    });
    return json({ ok: true });
  },
});
