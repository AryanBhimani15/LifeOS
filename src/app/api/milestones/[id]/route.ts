import { defineRoute, json, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { updateMilestoneSchema } from "@/lib/validation/goal";
import { deleteMilestone, updateMilestone } from "@/lib/repositories/goals";
import type { z } from "zod";

type Patch = z.infer<typeof updateMilestoneSchema>;

export const PATCH = defineRoute<Patch>({
  rateLimit: RATE_LIMITS.write,
  body: updateMilestoneSchema,
  handler: ({ userId, body, params }) =>
    updateMilestone(userId, routeParam(params, "id", "milestone id"), body),
});

export const DELETE = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params }) => {
    await deleteMilestone(userId, routeParam(params, "id", "milestone id"));
    return json({ ok: true });
  },
});
