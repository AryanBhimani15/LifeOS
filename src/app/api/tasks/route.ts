import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createTaskSchema, taskQuerySchema } from "@/lib/validation/task";
import { createTask, listTasks } from "@/lib/repositories/tasks";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  query: taskQuerySchema,
  handler: ({ userId, query }) => listTasks(userId, query),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: createTaskSchema,
  handler: async ({ userId, body }) => json(await createTask(userId, body), { status: 201 }),
});
