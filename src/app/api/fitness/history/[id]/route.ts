import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { deleteWorkout } from "@/lib/repositories/fitness";
import { badRequest } from "@/lib/errors";

function entryId(params: Record<string, string | string[]>): string {
  const id = params.id;
  if (typeof id !== "string") throw badRequest("Invalid entry id");
  return id;
}

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    await deleteWorkout(userId, entryId(params));
    return json({ ok: true });
  },
});
