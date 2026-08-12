"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireOwned } from "@/lib/authz";
import { updateTask, captureTask, deleteTask, reorderTask } from "@/lib/repositories/tasks";
import { todayDateInZone } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";
import type { TaskStatus } from "@/generated/prisma/enums";

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
  await updateTask(userId, taskId, { status: "DONE" });
  revalidatePath("/today");
  revalidatePath("/tasks");
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
}

export interface AddTaskResult {
  error?: string;
  task?: { id: string; title: string; dueAt: string | null; dueHasTime: boolean };
  /** The words that became the date, echoed back so the reading is visible. */
  matchedText?: string | null;
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
