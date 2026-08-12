import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { listActivities } from "@/lib/repositories/fitness";

/**
 * The activity catalogue.
 *
 * Shared reference data rather than anything user-owned, but still behind auth:
 * there is no reason to serve it to the public internet, and keeping every
 * route on the same footing means no one has to reason about which are open.
 */
export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async () => ({ activities: await listActivities() }),
});
