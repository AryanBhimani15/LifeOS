import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { previewMobileTaskCapture } from "@/lib/repositories/mobile";
import { mobileCapturePreviewSchema } from "@/lib/validation/mobile";

/** Native clients preview exactly the parser that will run when they add. */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.read,
  body: mobileCapturePreviewSchema,
  handler: ({ userId, body }) => previewMobileTaskCapture(userId, body.text),
});
