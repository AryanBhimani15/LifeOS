import { defineRoute, json, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { updateHabitSchema, type UpdateHabitInput } from "@/lib/validation/habit";
import { deleteHabit, getHabit, updateHabit } from "@/lib/repositories/habits";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId, params }) => getHabit(userId, routeParam(params, "id", "habit id")),
});

export const PATCH = defineRoute<UpdateHabitInput>({
  rateLimit: RATE_LIMITS.write,
  body: updateHabitSchema,
  handler: ({ userId, body, params }) =>
    updateHabit(userId, routeParam(params, "id", "habit id"), body),
});

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    await deleteHabit(userId, routeParam(params, "id", "habit id"));
    return json({ ok: true });
  },
});
