import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createEventSchema } from "@/lib/validation/event";
import { createEvent, listUpcomingEvents } from "@/lib/repositories/events";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async ({ userId }) => ({ events: await listUpcomingEvents(userId, 10) }),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: createEventSchema,
  handler: async ({ userId, body }) => json(await createEvent(userId, body), { status: 201 }),
});
