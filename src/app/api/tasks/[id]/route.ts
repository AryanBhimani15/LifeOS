import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { updateTaskSchema } from "@/lib/validation/task";
import { deleteTask, getTask, updateTask } from "@/lib/repositories/tasks";
import { recordAudit, requestMeta } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

function taskId(params: Record<string, string | string[]>): string {
  const id = params.id;
  if (typeof id !== "string") throw badRequest("Invalid task id");
  return id;
}

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: ({ userId, params }) => getTask(userId, taskId(params)),
});

export const PATCH = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: updateTaskSchema,
  handler: ({ userId, body, params }) => updateTask(userId, taskId(params), body),
});

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params, request }) => {
    const id = taskId(params);
    await deleteTask(userId, id);
    await recordAudit({
      userId,
      action: "DELETE",
      entityType: "Task",
      entityId: id,
      summary: "Task deleted",
      ...requestMeta(request),
    });
    return json({ ok: true });
  },
});
