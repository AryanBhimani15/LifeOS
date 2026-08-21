import { z } from "zod";
import { defineRoute, json } from "@/lib/api";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationCenter,
} from "@/lib/repositories/notifications";
import { RATE_LIMITS } from "@/lib/rate-limit";

const updateNotificationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.string().min(1).max(128) }),
  z.object({ action: z.literal("read-all") }),
]);

export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async ({ userId }) => {
    const center = await notificationCenter(userId);
    return json({
      unread: center.unread,
      items: center.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
});

export const PATCH = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: updateNotificationSchema,
  handler: async ({ userId, body }) => {
    if (body.action === "read") await markNotificationRead(userId, body.id);
    else await markAllNotificationsRead(userId);
    const center = await notificationCenter(userId);
    return json({ unread: center.unread }, { headers: { "Cache-Control": "private, no-store" } });
  },
});
