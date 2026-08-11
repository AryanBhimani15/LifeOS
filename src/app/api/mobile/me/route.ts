import { defineRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Bootstrap for the mobile client.
 *
 * Deliberately thin. The mobile app is a capture surface, not a dashboard, so
 * this returns identity, the timezone the server will interpret commands in,
 * and two counts — just enough for a one-line status under the mic button. It
 * is NOT a feed, and adding one here is how a capture app quietly turns into a
 * second-rate dashboard.
 */
export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async ({ userId, authMethod }) => {
    const now = new Date();

    const [user, settings, overdue, dueToday] = await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      }),
      db.userSettings.findUnique({
        where: { userId },
        select: { timezone: true, currency: true, aiEnabled: true },
      }),
      db.task.count({
        where: {
          userId,
          isTemplate: false,
          status: { notIn: ["DONE", "CANCELLED"] },
          dueAt: { lt: now },
        },
      }),
      db.task.count({
        where: {
          userId,
          isTemplate: false,
          status: { notIn: ["DONE", "CANCELLED"] },
          dueAt: { gte: now, lte: new Date(now.getTime() + 86_400_000) },
        },
      }),
    ]);

    return json({
      user,
      timezone: settings?.timezone ?? "UTC",
      aiEnabled: settings?.aiEnabled ?? true,
      counts: { overdue, dueNext24h: dueToday },
      authMethod,
    });
  },
});
