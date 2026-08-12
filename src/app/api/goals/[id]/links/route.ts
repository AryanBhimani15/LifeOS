import { defineRoute, json, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { linkSchema } from "@/lib/validation/goal";
import { linkHabit, linkTask, unlinkHabit, unlinkTask } from "@/lib/repositories/goals";
import type { z } from "zod";

type Link = z.infer<typeof linkSchema>;

/**
 * Attaching existing work to a goal, and detaching it again.
 *
 * Both directions only ever write a foreign key. Nothing here creates a task or
 * a habit, because a goal is not a second place to make them — there is one
 * Tasks feature in this application and this endpoint points at it.
 */
async function apply(
  userId: string,
  goalId: string,
  body: Link,
  task: (u: string, g: string, id: string) => Promise<void>,
  habit: (u: string, g: string, id: string) => Promise<void>,
) {
  if (body.taskId) return task(userId, goalId, body.taskId);
  if (body.habitId) return habit(userId, goalId, body.habitId);
  throw badRequest("Send either a taskId or a habitId.");
}

export const POST = defineRoute<Link>({
  rateLimit: RATE_LIMITS.write,
  body: linkSchema,
  handler: async ({ userId, body, params }) => {
    await apply(userId, routeParam(params, "id", "goal id"), body, linkTask, linkHabit);
    return json({ ok: true });
  },
});

export const DELETE = defineRoute<Link>({
  rateLimit: RATE_LIMITS.write,
  body: linkSchema,
  handler: async ({ userId, body, params }) => {
    await apply(userId, routeParam(params, "id", "goal id"), body, unlinkTask, unlinkHabit);
    return json({ ok: true });
  },
});
