import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getTaskDetail } from "@/lib/repositories/tasks";
import { badRequest } from "@/lib/errors";

/**
 * Everything the task detail panel needs.
 *
 * Separate from `GET /api/tasks/:id` because that one serves the board and
 * deliberately does not drag subtasks, reminders and events along with it.
 */
export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid task id");
    return getTaskDetail(userId, id);
  },
});
