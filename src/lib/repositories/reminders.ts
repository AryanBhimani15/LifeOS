import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";

/**
 * Shared reminder writes.
 *
 * `remindAt` is always an absolute instant. Event-relative reminders also keep
 * their offset, allowing an event move to recompute the instant without
 * asking the client to be open or to understand the user's timezone again.
 */
const resetForDelivery = (remindAt: Date, relativeMinutesBefore: number | null) => ({
  remindAt,
  relativeMinutesBefore,
  status: "PENDING" as const,
  sentAt: null,
  attemptCount: 0,
  retryAt: null,
  lastError: null,
  deliveryVersion: { increment: 1 },
});

export async function setTaskReminder(userId: string, taskId: string, remindAt: Date | null) {
  const task = await db.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
  if (!task) throw notFound("Task");

  const existing = await db.reminder.findFirst({
    where: { userId, taskId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!remindAt) {
    await db.reminder.deleteMany({ where: { userId, taskId } });
    return null;
  }
  return existing
    ? db.reminder.update({
        where: { id: existing.id },
        data: resetForDelivery(remindAt, null),
        select: { id: true, remindAt: true, status: true },
      })
    : db.reminder.create({
        data: { userId, taskId, remindAt },
        select: { id: true, remindAt: true, status: true },
      });
}

export type EventReminderInput =
  | { relativeMinutesBefore: number }
  | { remindAt: Date }
  /** Backwards-compatible absolute form for existing server callers. */
  | Date;

export async function setEventReminder(
  userId: string,
  eventId: string,
  input: EventReminderInput | null,
) {
  const event = await db.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true, startAt: true },
  });
  if (!event) throw notFound("Event");

  const existing = await db.reminder.findFirst({ where: { eventId, userId }, select: { id: true } });
  if (!input) {
    await db.reminder.deleteMany({ where: { userId, eventId } });
    return null;
  }

  const isRelative = !(input instanceof Date) && "relativeMinutesBefore" in input;
  const relativeMinutesBefore = isRelative ? input.relativeMinutesBefore : null;
  const remindAt = isRelative
    ? new Date(event.startAt.getTime() - input.relativeMinutesBefore * 60_000)
    : input instanceof Date ? input : input.remindAt;

  return existing
    ? db.reminder.update({
        where: { id: existing.id },
        data: resetForDelivery(remindAt, relativeMinutesBefore),
        select: { id: true, remindAt: true, relativeMinutesBefore: true, status: true },
      })
    : db.reminder.create({
        data: { userId, eventId, remindAt, relativeMinutesBefore },
        select: { id: true, remindAt: true, relativeMinutesBefore: true, status: true },
      });
}

/** Re-arms event-relative reminders whenever the original event moves. */
export async function recomputeRelativeEventReminders(
  tx: Prisma.TransactionClient,
  eventId: string,
  startAt: Date,
) {
  const reminders = await tx.reminder.findMany({
    where: { eventId, relativeMinutesBefore: { not: null } },
    select: { id: true, relativeMinutesBefore: true },
  });
  await Promise.all(reminders.map((reminder) => tx.reminder.update({
    where: { id: reminder.id },
    data: resetForDelivery(
      new Date(startAt.getTime() - (reminder.relativeMinutesBefore ?? 0) * 60_000),
      reminder.relativeMinutesBefore,
    ),
  })));
}
