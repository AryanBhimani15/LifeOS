"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { requireOwned } from "@/lib/authz";
import { updateTask, createTask, deleteTask, reorderTask } from "@/lib/repositories/tasks";
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

export async function createTaskAction(formData: FormData) {
  const userId = await requireUserId();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "A task needs a title." };

  const statusRaw = String(formData.get("status") ?? "TODO");
  const status = (["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const).includes(
    statusRaw as TaskStatus,
  )
    ? (statusRaw as TaskStatus)
    : "TODO";

  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority = (["LOW", "MEDIUM", "HIGH", "URGENT"] as const).includes(
    priorityRaw as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  )
    ? (priorityRaw as "LOW" | "MEDIUM" | "HIGH" | "URGENT")
    : "MEDIUM";

  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  // A datetime-local input has no offset; treat it as the browser's local time.
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return { error: "That due date isn't valid." };

  await createTask(userId, {
    title,
    status,
    priority,
    dueAt,
    tagIds: [],
  });

  revalidatePath("/tasks");
  revalidatePath("/today");
  return { ok: true };
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
