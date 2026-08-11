import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { reorderSchema } from "@/lib/validation/task";
import { reorderTask } from "@/lib/repositories/tasks";

/** Drag-and-drop target for the Kanban board. */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: reorderSchema,
  handler: ({ userId, body }) =>
    reorderTask(userId, body.taskId, body.status, body.beforeId, body.afterId),
});
