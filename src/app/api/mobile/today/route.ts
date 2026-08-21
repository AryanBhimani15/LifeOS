import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { mobileToday } from "@/lib/repositories/mobile";

/** A calm, bounded native read model rather than a copy of the web dashboard. */
export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId }) => mobileToday(userId),
});
