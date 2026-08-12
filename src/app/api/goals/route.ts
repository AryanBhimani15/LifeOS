import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createGoalSchema, listGoalsSchema } from "@/lib/validation/goal";
import { createGoal, goalStats, listGoals } from "@/lib/repositories/goals";
import type { CreateGoalInput, ListGoalsQuery } from "@/lib/validation/goal";

export const GET = defineRoute<undefined, ListGoalsQuery>({
  rateLimit: RATE_LIMITS.read,
  query: listGoalsSchema,
  handler: async ({ userId, query }) => ({
    goals: await listGoals(userId, query),
    stats: await goalStats(userId),
  }),
});

export const POST = defineRoute<CreateGoalInput>({
  rateLimit: RATE_LIMITS.write,
  body: createGoalSchema,
  handler: async ({ userId, body }) => json(await createGoal(userId, body), { status: 201 }),
});
