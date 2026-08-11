import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { executePlan } from "@/lib/ai/executor";
import { executePlanSchema } from "@/lib/validation/mobile";
import { badRequest } from "@/lib/errors";

/**
 * Runs a previously planned command.
 *
 * `confirmed` must be sent explicitly for a destructive plan; the server refuses
 * without it, so the confirmation dialog is a courtesy rather than the control.
 *
 * `idempotencyKey` lets a client that lost the response retry safely: the same
 * key on an already-executed plan replays the stored result. Mobile networks
 * drop responses often enough that without this, a successful command reads as
 * a failure and invites the user to run it again.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: executePlanSchema,
  handler: ({ userId, body, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid plan id");
    return executePlan(userId, id, body.confirmed, body.idempotencyKey);
  },
});
