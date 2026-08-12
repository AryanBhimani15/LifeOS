import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { fitnessProfileSchema } from "@/lib/validation/fitness";
import { getProfile } from "@/lib/repositories/fitness";
import { completeOnboarding } from "@/lib/repositories/onboarding";
import { recordAudit, requestMeta } from "@/lib/audit";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async ({ userId }) => ({ profile: await getProfile(userId) }),
});

/**
 * Saves the answers and builds everything that follows from them.
 *
 * PUT rather than PATCH because onboarding always submits every answer, and a
 * partial update would let a half-filled form leave the row in a state the
 * dashboard cannot render.
 *
 * The response is a summary of what was created, not just an acknowledgement:
 * the completion screen shows the user what they now have, which is the payoff
 * for having answered eight questions.
 */
export const PUT = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: fitnessProfileSchema,
  handler: async ({ userId, body, request }) => {
    const summary = await completeOnboarding(userId, body);
    await recordAudit({
      userId,
      action: "SETTINGS_CHANGE",
      entityType: "FitnessProfile",
      summary: `Setup completed — ${summary.plan?.daysPerWeek ?? 0}-day plan, ${summary.goalsCreated} goals`,
      ...requestMeta(request),
    });
    return summary;
  },
});
