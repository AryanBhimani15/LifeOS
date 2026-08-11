import { defineRoute, json } from "@/lib/api";
import { refreshSchema } from "@/lib/validation/mobile";
import { refreshTokens } from "@/lib/mobile-auth";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Exchanges a refresh token for a fresh access token.
 *
 * `auth: false` because the access token is, by definition, expired when this
 * is called — the refresh token itself is the credential. It is verified inside
 * `refreshTokens`, which rejects unknown, revoked and expired tokens with one
 * indistinguishable message.
 *
 * The refresh token is returned unchanged rather than rotated: see the note in
 * src/lib/mobile-auth.ts on why rotation would strand clients on flaky links.
 */
export const POST = defineRoute({
  auth: false,
  rateLimit: RATE_LIMITS.anonymous,
  body: refreshSchema,
  handler: async ({ body }) => json(await refreshTokens(body.refreshToken)),
});
