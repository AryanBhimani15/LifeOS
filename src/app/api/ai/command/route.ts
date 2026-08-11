import { z } from "zod";
import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createProvider } from "@/lib/ai/provider";
import { planCommand } from "@/lib/ai/planner";
import { db } from "@/lib/db";
import { aiUnavailable } from "@/lib/errors";

const commandSchema = z.object({
  input: z.string().trim().min(1, "Say what you'd like to do").max(2_000),
});

/**
 * Turns a natural-language command into a plan. Never mutates — execution is a
 * separate, explicitly confirmed request.
 *
 * Rate limited hard: every call costs real API quota, and the free Gemini tier
 * allows only 20 requests a minute across the whole key.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.ai,
  body: commandSchema,
  handler: async ({ userId, body }) => {
    const settings = await db.userSettings.findUnique({
      where: { userId },
      select: { aiEnabled: true },
    });
    if (settings && !settings.aiEnabled) {
      throw aiUnavailable("AI features are switched off in your settings.");
    }

    return planCommand(userId, body.input, createProvider());
  },
});
