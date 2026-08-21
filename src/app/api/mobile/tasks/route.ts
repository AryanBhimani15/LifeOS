import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createMobileTaskCapture, mobileTaskList } from "@/lib/repositories/mobile";
import { mobileQuickCaptureSchema, mobileTaskListQuerySchema } from "@/lib/validation/mobile";

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  query: mobileTaskListQuerySchema,
  handler: ({ userId, query }) => mobileTaskList(userId, query),
});

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: mobileQuickCaptureSchema,
  handler: async ({ userId, body }) => json(await createMobileTaskCapture(userId, body), { status: 201 }),
});
