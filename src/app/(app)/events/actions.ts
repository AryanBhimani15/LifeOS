"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { captureTask, updateTask } from "@/lib/repositories/tasks";
import { createEventNote, linkTaskToEvent, setEventReminder, setNoteEvent, unlinkTaskFromEvent, updateEvent } from "@/lib/repositories/events";
import type { TaskStatus } from "@/generated/prisma/enums";

/**
 * Server actions for the event page.
 *
 * Preparation tasks go through `captureTask` like every other task — the same
 * parser, the same board ordering, the same everything. The only difference is
 * that the created task is then linked to the event. A preparation task is
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

  const event = await db.event.findFirst({ where: { id: eventId, userId }, select: { id: true } });
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

  await linkTaskToEvent(userId, eventId, task.id);

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
  const linked = await db.eventPreparationTask.findFirst({
    where: { eventId, taskId, event: { userId }, task: { userId } },
    select: { taskId: true },
  });
  if (!linked) return { error: "That task is not preparation for this event." };
  await updateTask(userId, taskId, { status, tagIds: [] });
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/today");
  revalidatePath("/tasks");
  return {};
}

export async function linkExistingPrepTaskAction(eventId: string, taskId: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await linkTaskToEvent(userId, eventId, taskId);
    revalidatePath(`/events/${eventId}`); revalidatePath("/tasks"); revalidatePath("/today");
    return {};
  } catch { return { error: "That task or event is no longer available." }; }
}

export async function unlinkPrepTaskAction(eventId: string, taskId: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await unlinkTaskFromEvent(userId, eventId, taskId);
    revalidatePath(`/events/${eventId}`); revalidatePath("/tasks"); revalidatePath("/today");
    return {};
  } catch { return { error: "Couldn't remove that connection." }; }
}

export async function addEventRelatedNoteAction(eventId: string, content: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await createEventNote(userId, eventId, content);
    revalidatePath(`/events/${eventId}`); revalidatePath("/notes"); revalidatePath("/today");
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : "Couldn't save that note." }; }
}

export async function setEventNoteRelationAction(eventId: string, noteId: string, attached: boolean): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await setNoteEvent(userId, noteId, attached ? eventId : null);
    revalidatePath(`/events/${eventId}`); revalidatePath("/notes"); revalidatePath("/today");
    return {};
  } catch { return { error: "Couldn't change that note connection." }; }
}

export async function setEventReminderAction(
  eventId: string,
  value: string | null,
  relativeMinutesBefore: number | null = null,
): Promise<{ error?: string; remindAt?: string | null; relativeMinutesBefore?: number | null }> {
  const userId = await requireUserId();
  const date = value ? new Date(value) : null;
  if (value && (!date || Number.isNaN(date.getTime()))) return { error: "Choose a valid reminder time." };
  if (relativeMinutesBefore !== null && (!Number.isInteger(relativeMinutesBefore) || relativeMinutesBefore < 0 || relativeMinutesBefore > 10_080)) {
    return { error: "Choose a reminder within seven days of the event." };
  }
  try {
    const reminder = await setEventReminder(
      userId,
      eventId,
      relativeMinutesBefore === null ? (date ? { remindAt: date } : null) : { relativeMinutesBefore },
    );
    revalidatePath(`/events/${eventId}`); revalidatePath("/today");
    return {
      remindAt: reminder?.remindAt.toISOString() ?? null,
      relativeMinutesBefore: reminder?.relativeMinutesBefore ?? null,
    };
  } catch { return { error: "Couldn't change that reminder." }; }
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
