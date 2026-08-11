import { defineRoute, json } from "@/lib/api";
import { db } from "@/lib/db";
import { registerDeviceSchema } from "@/lib/validation/mobile";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Registers or refreshes a push target.
 *
 * The client calls this on every cold launch. iOS silently reissues push tokens
 * after an OS update or a backup restore, and a server holding the stale one
 * fails to deliver with no error anywhere — so `lastSeenAt` is bumped every time
 * and stale rows can be pruned.
 *
 * NOTE: registration is implemented; actual delivery is not. Sending to APNs
 * needs an Apple Developer account and signing key, which this project does not
 * have. Stored tokens are inert until those exist. See docs/mobile.md.
 */
export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  body: registerDeviceSchema,
  handler: async ({ userId, body }) => {
    const device = await db.device.upsert({
      where: { userId_installId: { userId, installId: body.installId } },
      create: {
        userId,
        installId: body.installId,
        platform: body.platform,
        pushToken: body.pushToken ?? null,
        appVersion: body.appVersion ?? null,
      },
      update: {
        platform: body.platform,
        pushToken: body.pushToken ?? null,
        appVersion: body.appVersion ?? null,
        lastSeenAt: new Date(),
      },
      select: { id: true, installId: true, platform: true, lastSeenAt: true },
    });

    return json({
      device,
      // Stated plainly so a client cannot mistake registration for delivery.
      pushDeliveryEnabled: false,
      note: "Push registration stored. Delivery requires APNs credentials, which are not configured.",
    });
  },
});
