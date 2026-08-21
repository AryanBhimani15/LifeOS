import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { setTaskReminder } from "@/lib/repositories/reminders";
import { mobileTaskReminderSchema } from "@/lib/validation/mobile";
import { badRequest } from "@/lib/errors";

function taskId(params: Record<string, string | string[]>): string {
  const id = params.id;
  if (typeof id !== "string") throw badRequest("Invalid task id");
  return id;
}

/** Native companion access to the same task-reminder writer used by LifeOS. */
export const PUT = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: mobileTaskReminderSchema,
  handler: ({ userId, body, params }) => setTaskReminder(userId, taskId(params), body.remindAt ? new Date(body.remindAt) : null),
});
