import { z } from "zod";
import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { answerQuery } from "@/lib/ai/queries";

/**
 * Answers a known question directly from the database — no AI.
 *
 * The answers never needed a model. `answerQuery` is pure SQL; the AI's only
 * contribution was classifying which of these seven questions was being asked,
 * and a button does that for free and without failing when quota runs out.
 *
 * /api/ai/command still exists for phrasing a button cannot capture. This is the
 * fast path for the questions people actually ask every day.
 */
const querySchema = z.object({
  kind: z.enum([
    "today",
    "overdue",
    "due_this_week",
    "at_risk",
    "habit_status",
    "goal_progress",
    "spending_summary",
  ]),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.read,
  body: querySchema,
  handler: async ({ userId, body }) => json(await answerQuery(userId, body.kind)),
});
