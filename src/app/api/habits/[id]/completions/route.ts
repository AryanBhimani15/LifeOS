import { defineRoute, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { setCompletionSchema } from "@/lib/validation/habit";
import { setCompletion } from "@/lib/repositories/habits";
import type { z } from "zod";

type Body = z.infer<typeof setCompletionSchema>;

/**
 * Marking a day done, or undoing it.
 *
 * A PUT of the desired state rather than a toggle: a toggle sent twice by a
 * flaky connection lands back where it started, and the caller can never be
 * sure which. Sending `done: true` twice means done, both times.
 */
export const PUT = defineRoute<Body>({
  rateLimit: RATE_LIMITS.write,
  body: setCompletionSchema,
  handler: ({ userId, body, params }) =>
    setCompletion(userId, routeParam(params, "id", "habit id"), body.done, body.on),
});
