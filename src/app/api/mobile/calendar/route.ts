import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { mobileCalendar } from "@/lib/repositories/mobile";
import { mobileCalendarQuerySchema } from "@/lib/validation/mobile";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  query: mobileCalendarQuerySchema,
  handler: ({ userId, query }) => mobileCalendar(userId, query.date ?? new Date().toISOString().slice(0, 10)),
});
