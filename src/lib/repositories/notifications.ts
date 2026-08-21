import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000;

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string;
  readAt: Date | null;
  createdAt: Date;
}

/** The compact bell payload, always scoped to its owner. */
export async function notificationCenter(userId: string, limit = 12) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationRead(userId: string, id: string) {
  return db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string) {
  return db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

function copyFor(reminder: {
  taskId: string | null;
  eventId: string | null;
  task: { title: string; dueAt: Date | null } | null;
  event: { title: string; startAt: Date; kind: string } | null;
}) {
  if (reminder.task) {
    return {
      title: reminder.task.title,
      body: reminder.task.dueAt ? "Reminder · task due soon" : "Reminder · task",
      href: `/tasks?focus=${reminder.taskId}`,
    };
  }
  if (reminder.event) {
    return {
      title: reminder.event.title,
      body: `${reminder.event.kind === "EXAM" ? "Exam" : "Event"} reminder`,
      href: `/events/${reminder.eventId}`,
    };
  }
  return null;
}

/**
 * Delivers due reminders to the in-app channel.
 *
 * This is scheduler-independent business logic. The unique
 * `(reminderId, deliveryVersion)` notification key is the final idempotency
 * barrier: two overlapping workers cannot produce two messages. The reminder
 * state update and notification insertion share one transaction.
 */
export async function processDueReminders({ now = new Date(), limit = 100 }: { now?: Date; limit?: number } = {}) {
  const candidates = await db.reminder.findMany({
    where: {
      OR: [
        { status: "PENDING", remindAt: { lte: now } },
        { status: "FAILED", retryAt: { lte: now }, attemptCount: { lt: MAX_ATTEMPTS } },
      ],
    },
    select: { id: true },
    orderBy: { remindAt: "asc" },
    take: limit,
  });

  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await db.$transaction(async (tx) => {
        const reminder = await tx.reminder.findFirst({
          where: {
            id: candidate.id,
            OR: [
              { status: "PENDING", remindAt: { lte: now } },
              { status: "FAILED", retryAt: { lte: now }, attemptCount: { lt: MAX_ATTEMPTS } },
            ],
          },
          select: {
            id: true, userId: true, taskId: true, eventId: true, deliveryVersion: true,
            task: { select: { title: true, dueAt: true } },
            event: { select: { title: true, startAt: true, kind: true } },
          },
        });
        if (!reminder) return "skipped" as const;
        const copy = copyFor(reminder);
        // A source deletion cascades its reminder. This guard also makes a
        // malformed legacy reminder safe rather than inventing a message.
        if (!copy) return "skipped" as const;
        await tx.notification.create({
          data: {
            userId: reminder.userId,
            reminderId: reminder.id,
            deliveryVersion: reminder.deliveryVersion,
            ...copy,
          },
        });
        await tx.reminder.update({
          where: { id: reminder.id },
          data: { status: "DELIVERED", sentAt: now, retryAt: null, lastError: null, attemptCount: { increment: 1 } },
        });
        return "delivered" as const;
      });
      if (result === "delivered") delivered += 1;
      else skipped += 1;
    } catch (error) {
      // The unique notification key means another worker won the same delivery.
      // Its transaction also sets DELIVERED, so there is nothing to retry here.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped += 1;
        continue;
      }
      failed += 1;
      const attempt = await db.reminder.findFirst({ where: { id: candidate.id }, select: { attemptCount: true } });
      if (attempt) {
        const nextCount = attempt.attemptCount + 1;
        await db.reminder.updateMany({
          where: { id: candidate.id, status: { in: ["PENDING", "FAILED"] } },
          data: {
            status: "FAILED",
            attemptCount: nextCount,
            retryAt: nextCount < MAX_ATTEMPTS ? new Date(now.getTime() + RETRY_DELAY_MS) : null,
            lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error",
          },
        });
      }
      console.error("[reminders] delivery failed", { reminderId: candidate.id, error });
    }
  }
  return { scanned: candidates.length, delivered, skipped, failed };
}
