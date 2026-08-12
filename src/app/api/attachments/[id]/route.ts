import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { removeAttachment } from "@/lib/repositories/events";

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid attachment id");
    await removeAttachment(userId, id);
    return json({ ok: true });
  },
});
