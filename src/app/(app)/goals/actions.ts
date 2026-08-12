"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { AppError } from "@/lib/errors";
import {
  addMilestone,
  createGoal,
  deleteGoal,
  deleteMilestone,
  linkHabit,
  linkTask,
  reorderMilestones,
  unlinkHabit,
  unlinkTask,
  updateGoal,
  updateMilestone,
} from "@/lib/repositories/goals";
import {
  createGoalSchema,
  createMilestoneSchema,
  updateGoalSchema,
  updateMilestoneSchema,
} from "@/lib/validation/goal";

/**
 * Server actions for the Goals pages.
 *
 * Every one of them validates with the same schema the API route uses, so the
 * two entry points cannot drift into disagreeing about what a valid goal is.
 * They return `{ error }` rather than throwing: the forms show the message
 * beside the field, and an unexpected failure still reaches the error boundary.
 */

type Result = { error?: string };

/** Turns a thrown AppError or a Zod failure into one sentence for the form. */
function failure(error: unknown): Result {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? "That does not look right." };
  }
  if (error instanceof AppError) return { error: error.message };
  throw error;
}

function refresh(goalId?: string) {
  revalidatePath("/goals");
  revalidatePath("/today");
  if (goalId) revalidatePath(`/goals/${goalId}`);
}

export async function createGoalAction(input: unknown): Promise<Result & { id?: string }> {
  const userId = await requireUserId();
  try {
    const goal = await createGoal(userId, createGoalSchema.parse(input));
    refresh(goal.id);
    return { id: goal.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateGoalAction(goalId: string, patch: unknown): Promise<Result> {
  const userId = await requireUserId();
  try {
    await updateGoal(userId, goalId, updateGoalSchema.parse(patch));
    refresh(goalId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function deleteGoalAction(goalId: string): Promise<Result> {
  const userId = await requireUserId();
  try {
    await deleteGoal(userId, goalId);
    refresh();
    // Tasks and habits keep existing with their link cleared, so the pages that
    // list them are stale until they are told.
    revalidatePath("/tasks");
    revalidatePath("/habits");
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function addMilestoneAction(goalId: string, input: unknown): Promise<Result> {
  const userId = await requireUserId();
  try {
    await addMilestone(userId, goalId, createMilestoneSchema.parse(input));
    refresh(goalId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function updateMilestoneAction(
  goalId: string,
  milestoneId: string,
  patch: unknown,
): Promise<Result> {
  const userId = await requireUserId();
  try {
    await updateMilestone(userId, milestoneId, updateMilestoneSchema.parse(patch));
    refresh(goalId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function deleteMilestoneAction(
  goalId: string,
  milestoneId: string,
): Promise<Result> {
  const userId = await requireUserId();
  try {
    await deleteMilestone(userId, milestoneId);
    refresh(goalId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function reorderMilestonesAction(goalId: string, ids: string[]): Promise<Result> {
  const userId = await requireUserId();
  try {
    await reorderMilestones(userId, goalId, ids);
    refresh(goalId);
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function linkTaskAction(
  goalId: string,
  taskId: string,
  linked: boolean,
): Promise<Result> {
  const userId = await requireUserId();
  try {
    await (linked ? linkTask : unlinkTask)(userId, goalId, taskId);
    refresh(goalId);
    revalidatePath("/tasks");
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function linkHabitAction(
  goalId: string,
  habitId: string,
  linked: boolean,
): Promise<Result> {
  const userId = await requireUserId();
  try {
    await (linked ? linkHabit : unlinkHabit)(userId, goalId, habitId);
    refresh(goalId);
    revalidatePath("/habits");
    return {};
  } catch (error) {
    return failure(error);
  }
}
