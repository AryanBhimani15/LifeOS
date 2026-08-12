"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { captureTask, updateTask } from "@/lib/repositories/tasks";
import { updateEvent } from "@/lib/repositories/events";
import type { TaskStatus } from "@/generated/prisma/enums";

/**
 * Server actions for the event page.
 *
 * Preparation tasks go through `captureTask` like every other task — the same
 * parser, the same board ordering, the same everything. The only difference is
 * that the created task is then pointed at by the event. A preparation task is
 * an ordinary task that happens to be linked, not a different kind of thing,
 * which is why unlinking one leaves a perfectly usable task behind.
 */

export async function addPrepTaskAction(
  eventId: string,
  text: string,
): Promise<{ error?: string }> {
  const userId = await requireUserId();

  const trimmed = text.trim();
  if (!trimmed) return { error: "Type something to add it." };

  const event = await db.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true, taskId: true },
  });
  if (!event) return { error: "That event no longer exists." };

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });

  const { task } = await captureTask(
    userId,
    { text: trimmed },
    { timeZone: settings?.timezone ?? "UTC", weekStartsOn: settings?.weekStartsOn ?? 1 },
  );

  // Event.taskId holds the primary linked task. Additional preparation tasks
  // are linked by pointing the event at them in turn; the read side collects
  // every task the event references.
  if (!event.taskId) {
    await db.event.update({ where: { id: eventId }, data: { taskId: task.id } });
  } else {
    await db.task.update({ where: { id: task.id }, data: { parentId: event.taskId } });
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/today");
  revalidatePath("/tasks");
  return {};
}

export async function togglePrepTaskAction(
  eventId: string,
  taskId: string,
  status: TaskStatus,
): Promise<{ error?: string }> {
  const userId = await requireUserId();
  await updateTask(userId, taskId, { status, tagIds: [] });
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/today");
  revalidatePath("/tasks");
  return {};
}

export async function updateEventDetailAction(
  eventId: string,
  patch: { title?: string; description?: string | null; location?: string | null },
): Promise<{ error?: string }> {
  const userId = await requireUserId();

  if (patch.title !== undefined && !patch.title.trim()) {
    return { error: "An event needs a title." };
  }

  await updateEvent(userId, eventId, {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
  });

  revalidatePath(`/events/${eventId}`);
  return {};
}
