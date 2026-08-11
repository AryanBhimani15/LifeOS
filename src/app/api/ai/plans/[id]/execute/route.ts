import { z } from "zod";
import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { executePlan } from "@/lib/ai/executor";
import { badRequest } from "@/lib/errors";

const executeSchema = z.object({
  /**
   * Must be sent explicitly for a destructive plan. The server refuses without
   * it — the confirmation dialog is a courtesy, this flag is the control.
   */
  confirmed: z.boolean().default(false),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: executeSchema,
  handler: ({ userId, body, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid plan id");
    return executePlan(userId, id, body.confirmed);
  },
});
