import { defineRoute, json, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { updateGoalSchema, type UpdateGoalInput } from "@/lib/validation/goal";
import { deleteGoal, getGoal, updateGoal } from "@/lib/repositories/goals";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId, params }) => getGoal(userId, routeParam(params, "id", "goal id")),
});

export const PATCH = defineRoute<UpdateGoalInput>({
  rateLimit: RATE_LIMITS.write,
  body: updateGoalSchema,
  handler: ({ userId, body, params }) =>
    updateGoal(userId, routeParam(params, "id", "goal id"), body),
});

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    await deleteGoal(userId, routeParam(params, "id", "goal id"));
    return json({ ok: true });
  },
});
