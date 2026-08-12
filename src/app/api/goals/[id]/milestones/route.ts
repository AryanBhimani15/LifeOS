import { defineRoute, json, routeParam } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createMilestoneSchema, reorderMilestonesSchema } from "@/lib/validation/goal";
import { addMilestone, reorderMilestones } from "@/lib/repositories/goals";
import type { z } from "zod";

type Create = z.infer<typeof createMilestoneSchema>;
type Reorder = z.infer<typeof reorderMilestonesSchema>;

export const POST = defineRoute<Create>({
  rateLimit: RATE_LIMITS.write,
  body: createMilestoneSchema,
  handler: async ({ userId, body, params }) =>
    json(await addMilestone(userId, routeParam(params, "id", "goal id"), body), { status: 201 }),
});

/**
 * Reordering is a PUT of the whole ordered list rather than a per-item move:
 * the server never has to reconcile two half-applied orders, and a dropped
 * request leaves the previous order intact instead of a scrambled one.
 */
export const PUT = defineRoute<Reorder>({
  rateLimit: RATE_LIMITS.write,
  body: reorderMilestonesSchema,
  handler: async ({ userId, body, params }) => {
    await reorderMilestones(userId, routeParam(params, "id", "goal id"), body.ids);
    return json({ ok: true });
  },
});
