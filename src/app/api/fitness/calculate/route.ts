import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { workoutInputSchema } from "@/lib/validation/fitness";
import { previewBurn } from "@/lib/repositories/fitness";

/**
 * Works out a result without storing it.
 *
 * Separate from POST /history so that pressing Calculate repeatedly while
 * adjusting a duration does not fill the history with drafts. Nothing is
 * recorded until the user explicitly saves.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.read,
  body: workoutInputSchema,
  handler: ({ body }) => previewBurn(body),
});
