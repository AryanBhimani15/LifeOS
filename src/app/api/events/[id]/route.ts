import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { updateEventSchema } from "@/lib/validation/event";
import { deleteEvent, getEvent, updateEvent } from "@/lib/repositories/events";

function eventId(params: Record<string, string | string[]>): string {
  const id = params.id;
  if (typeof id !== "string") throw badRequest("Invalid event id");
  return id;
}

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId, params }) => getEvent(userId, eventId(params)),
});

export const PATCH = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: updateEventSchema,
  handler: ({ userId, body, params }) => updateEvent(userId, eventId(params), body),
});

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    await deleteEvent(userId, eventId(params));
    return json({ ok: true });
  },
});
