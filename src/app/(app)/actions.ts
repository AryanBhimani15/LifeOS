"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireOwned } from "@/lib/authz";
import { updateTask, captureTask, deleteTask, reorderTask } from "@/lib/repositories/tasks";
import { instantInZone, todayDateInZone, todayInZone } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";
import type { TaskStatus } from "@/generated/prisma/enums";
import { createEvent } from "@/lib/repositories/events";

/**
 * Server actions for the app UI.
 *
 * Every one resolves the session itself rather than trusting a userId from the
 * client — a server action is a public endpoint, reachable by anyone who can
 * craft a POST, so it needs exactly the same authorization as an API route.
 * Ownership of any id in the arguments is verified through the repositories.
 */

export async function toggleHabitAction(habitId: string) {
  const userId = await requireUserId();
  await requireOwned("habit", habitId, userId);

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const on = todayDateInZone(settings?.timezone ?? "UTC");

  const existing = await db.habitCompletion.findUnique({
    where: { habitId_completedOn: { habitId, completedOn: on } },
    select: { id: true },
  });

  if (existing) {
    await db.habitCompletion.delete({ where: { id: existing.id } });
  } else {
    await db.habitCompletion.create({ data: { habitId, userId, completedOn: on } });
  }

  revalidatePath("/today");
  return { done: !existing };
}

export async function completeTaskAction(taskId: string) {
  const userId = await requireUserId();
  const existing = await db.task.findFirst({ where: { id: taskId, userId }, select: { status: true } });
  if (!existing) return;
  await updateTask(userId, taskId, { status: existing.status === "DONE" ? "TODO" : "DONE" });
  revalidatePath("/today");
  revalidatePath("/tasks");
}

/** The Home checklist is intentionally faster than the general capture sheet:
 * every row it creates belongs to today, without asking for a second choice. */
export async function addTodayTaskAction(title: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const text = title.trim();
  if (!text) return { error: "Write a task first." };
  if (text.length > 500) return { error: "That task title is a little too long." };
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });
  const zone = settings?.timezone ?? "UTC";
  await captureTask(
    userId,
    { text, dueAt: instantInZone(todayInZone(zone), 23 * 60 + 59, zone), dueHasTime: false },
    { timeZone: zone, weekStartsOn: settings?.weekStartsOn ?? 1 },
  );
  revalidatePath("/today");
  revalidatePath("/tasks");
  return {};
}

export async function moveTaskAction(input: {
  taskId: string;
  status: TaskStatus;
  beforeId?: string | null;
  afterId?: string | null;
}) {
  const userId = await requireUserId();
  await reorderTask(userId, input.taskId, input.status, input.beforeId, input.afterId);
  revalidatePath("/tasks");
  revalidatePath("/today");
}

/**
 * The one server action that creates a task.
 *
 * It replaces two: a FormData action wanting title, status and priority, and a
 * title-only quick-add. Neither could read a date out of a sentence, and both
 * demanded decisions the user had not made yet.
 *
 * Everything is optional except the text. Status and priority are not asked
 * for at all — they are board concerns, decided later or never.
 */
export interface AddTaskInput {
  text: string;
  /**
   * From a date chip. `undefined` means "read the sentence"; `null` means the
   * user actively chose no date. The two must stay distinguishable.
   */
  dueAt?: string | null;
  dueHasTime?: boolean;
  note?: string | null;
  remindAt?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export interface AddTaskResult {
  error?: string;
  task?: { id: string; title: string; dueAt: string | null; dueHasTime: boolean };
  /** The words that became the date, echoed back so the reading is visible. */
  matchedText?: string | null;
}

export interface AddEventResult {
  error?: string;
  event?: { id: string; title: string; kind: "EXAM" | "EVENT"; startAt: string; endAt: string };
}

function autoTags(title: string): string[] {
  const ignored = new Set(["the", "and", "for", "with", "from", "this", "that", "exam", "event", "test"]);
  return [...new Set(title.match(/[A-Za-z][A-Za-z0-9+.-]*/g)?.map((word) => word.toUpperCase()).filter((word) => !ignored.has(word.toLowerCase()) && word.length > 1) ?? [])].slice(0, 3);
}

/**
 * Creates the richer calendar record used for exams and events. Time is
 * intentionally optional: without it this is an all-day event, never a fake
 * midnight appointment.
 */
export async function addEventAction(input: {
  text: string;
  kind: "EXAM" | "EVENT";
  date: string;
  time?: string | null;
  note?: string | null;
}): Promise<AddEventResult> {
  const userId = await requireUserId();
  const title = input.text.trim();
  if (!title) return { error: "Type a title first." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Choose a date for this event." };
  const settings = await db.userSettings.findUnique({ where: { userId }, select: { timezone: true } });
  const zone = settings?.timezone ?? "UTC";
  const time = input.time?.match(/^(\d{2}):(\d{2})$/);
  const minutes = time ? Number(time[1]) * 60 + Number(time[2]) : 0;
  if (time && (minutes < 0 || minutes >= 24 * 60)) return { error: "That time isn't valid." };
  const start = instantInZone(input.date, minutes, zone);
  const end = time ? new Date(start.getTime() + 60 * 60 * 1000) : new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  const event = await createEvent(userId, {
    title: title.slice(0, 200),
    kind: input.kind,
    startAt: start,
    endAt: end,
    allDay: !time,
    description: input.note?.trim() || null,
    tagNames: autoTags(title),
  });
  revalidatePath("/today");
  revalidatePath("/tasks");
  return { event: { ...event, kind: event.kind as "EXAM" | "EVENT", startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString() } };
}

export async function addQuickNoteAction(text: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const content = text.trim();
  if (!content) return { error: "Write a note first." };
  await db.note.create({
    data: { userId, title: content.split(/[.\n]/)[0]!.slice(0, 200), content },
  });
  revalidatePath("/today");
  revalidatePath("/notes");
  return {};
}

/** Notes can only be removed by their owner; both Home and the Notes archive
 * use this instead of trusting a client-side list mutation. */
export async function deleteNoteAction(noteId: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const note = await db.note.findFirst({ where: { id: noteId, userId }, select: { id: true } });
  if (!note) return { error: "That note no longer exists." };
  await db.note.delete({ where: { id: note.id } });
  revalidatePath("/today");
  revalidatePath("/notes");
  return {};
}

export async function addTaskAction(input: AddTaskInput): Promise<AddTaskResult> {
  const userId = await requireUserId();

  const text = String(input.text ?? "").trim();
  if (!text) return { error: "Type something to add it." };
  if (text.length > 500) return { error: "That is a little long for a task title." };

  const parseDate = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const dueAt = parseDate(input.dueAt);
  const remindAt = parseDate(input.remindAt) ?? null;

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });

  const { task, matchedText } = await captureTask(
    userId,
    {
      text,
      ...(dueAt !== undefined ? { dueAt, dueHasTime: input.dueHasTime ?? false } : {}),
      note: input.note ?? null,
      remindAt,
      priority: input.priority,
    },
    {
      timeZone: settings?.timezone ?? "UTC",
      weekStartsOn: settings?.weekStartsOn ?? 1,
    },
  );

  revalidatePath("/today");
  revalidatePath("/tasks");

  return {
    task: {
      id: task.id,
      title: task.title,
      dueAt: task.dueAt?.toISOString() ?? null,
      dueHasTime: task.dueHasTime,
    },
    matchedText,
  };
}

/** Edits an existing task from the detail view. Every field optional. */
export async function updateTaskDetailAction(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    dueAt?: string | null;
    dueHasTime?: boolean;
    status?: TaskStatus;
  },
): Promise<{ error?: string }> {
  const userId = await requireUserId();

  if (patch.title !== undefined && !patch.title.trim()) {
    return { error: "A task needs a title." };
  }

  const dueAt =
    patch.dueAt === undefined ? undefined : patch.dueAt === null ? null : new Date(patch.dueAt);
  if (dueAt instanceof Date && Number.isNaN(dueAt.getTime())) {
    return { error: "That date isn't valid." };
  }

  await updateTask(userId, taskId, {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(dueAt !== undefined ? { dueAt } : {}),
    ...(patch.dueHasTime !== undefined ? { dueHasTime: patch.dueHasTime } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    tagIds: [],
  });

  revalidatePath("/today");
  revalidatePath("/tasks");
  return {};
}

export async function deleteTaskAction(taskId: string) {
  const userId = await requireUserId();
  await deleteTask(userId, taskId);
  await recordAudit({
    userId,
    action: "DELETE",
    entityType: "Task",
    entityId: taskId,
    summary: "Task deleted from the board",
  });
  revalidatePath("/tasks");
  revalidatePath("/today");
}

/**
 * Sign out.
 *
 * Must go through Auth.js rather than a plain form POST to /api/auth/signout:
 * that endpoint requires a CSRF token, and a bare form without one is rejected
 * with `?error=MissingCSRF` while leaving the session intact — the button
 * appears to work and does nothing.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
