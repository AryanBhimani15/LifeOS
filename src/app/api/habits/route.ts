import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createHabitSchema, listHabitsSchema } from "@/lib/validation/habit";
import { createHabit, habitStats, listHabits } from "@/lib/repositories/habits";
import type { CreateHabitInput, ListHabitsQuery } from "@/lib/validation/habit";

export const GET = defineRoute<undefined, ListHabitsQuery>({
  rateLimit: RATE_LIMITS.read,
  query: listHabitsSchema,
  handler: async ({ userId, query }) => {
    const { habits, today } = await listHabits(userId, query);
    return { habits, today, stats: await habitStats(userId) };
  },
});

export const POST = defineRoute<CreateHabitInput>({
  rateLimit: RATE_LIMITS.write,
  body: createHabitSchema,
  handler: async ({ userId, body }) => json(await createHabit(userId, body), { status: 201 }),
});
