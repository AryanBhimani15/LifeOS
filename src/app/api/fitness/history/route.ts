import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { historyQuerySchema, workoutInputSchema } from "@/lib/validation/fitness";
import { listHistory, saveWorkout } from "@/lib/repositories/fitness";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  query: historyQuerySchema,
  handler: async ({ userId, query }) => ({ entries: await listHistory(userId, query.limit) }),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: workoutInputSchema,
  handler: async ({ userId, body }) => json(await saveWorkout(userId, body), { status: 201 }),
});
