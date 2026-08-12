import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { logPlannedSessionSchema } from "@/lib/validation/fitness";
import { logPlannedSession } from "@/lib/repositories/onboarding";

/**
 * Logs a planned session in one request.
 *
 * The body is a session id and nothing else. Activity, duration and calories
 * all come from the plan, so marking a workout done is one tap rather than
 * choosing from a dropdown and typing a number that is already known.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: logPlannedSessionSchema,
  handler: async ({ userId, body }) =>
    json(await logPlannedSession(userId, body.sessionId), { status: 201 }),
});
