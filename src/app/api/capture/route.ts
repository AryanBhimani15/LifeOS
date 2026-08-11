import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { captureSchema } from "@/lib/validation/capture";
import { capture } from "@/lib/repositories/capture";

/**
 * Direct capture — text in, record out, no AI.
 *
 * The counterpart to /api/ai/command. That endpoint interprets; this one simply
 * files what you already told it. Capture is the thing that must never fail, so
 * it has no dependency on a language model, no quota to exhaust, and no
 * confirmation step: you chose the type by tapping a button, so there is
 * nothing to confirm.
 *
 * Rated as a normal write rather than an AI call, because it costs nothing.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: captureSchema,
  handler: async ({ userId, body }) => json(await capture(userId, body), { status: 201 }),
});
