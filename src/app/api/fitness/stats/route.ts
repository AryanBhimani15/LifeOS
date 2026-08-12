import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getFitnessStats } from "@/lib/repositories/fitness";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId }) => getFitnessStats(userId),
});
