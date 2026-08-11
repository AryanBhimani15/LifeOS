import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { rejectPlan } from "@/lib/ai/executor";
import { badRequest } from "@/lib/errors";

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid plan id");
    await rejectPlan(userId, id);
    return json({ ok: true });
  },
});
