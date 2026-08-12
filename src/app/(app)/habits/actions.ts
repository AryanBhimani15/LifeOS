"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { AppError } from "@/lib/errors";
import {
  createHabit,
  deleteHabit,
  setCompletion,
  updateHabit,
} from "@/lib/repositories/habits";
import { createHabitSchema, updateHabitSchema } from "@/lib/validation/habit";

/**
 * Server actions for the Habits pages.
 *
 * Same shape as the Goals actions: the schema the API route uses is the schema
 * these use, so there is one definition of a valid habit rather than two that
 * drift.
 */

type Result = { error?: string };

function failure(error: unknown): Result {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? "That does not look right." };
  }
  if (error instanceof AppError) return { error: error.message };
  throw error;
}

function refresh(habitId?: string) {
  revalidatePath("/habits");
  revalidatePath("/today");
  if (habitId) revalidatePath(`/habits/${habitId}`);
}

export async function createHabitAction(input: unknown): Promise<Result & { id?: string }> {
  const userId = await requireUserId();
  try {
    const habit = await createHabit(userId, createHabitSchema.parse(input));
    refresh(habit.id);
    revalidatePath("/goals");
    return { id: habit.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateHabitAction(habitId: string, patch: unknown): Promise<Result> {
  const userId = await requireUserId();
  try {
    await updateHabit(userId, habitId, updateHabitSchema.parse(patch));
    refresh(habitId);
    revalidatePath("/goals");
    return {};
  } catch (error) {
    return failure(error);
  }
}

export async function deleteHabitAction(habitId: string): Promise<Result> {
  const userId = await requireUserId();
  try {
    await deleteHabit(userId, habitId);
    refresh();
    return {};
  } catch (error) {
    return failure(error);
  }
}

/**
 * Sets a day's state explicitly rather than toggling.
 *
 * The caller sends what it wants to be true, so a double-tap or a retried
 * request cannot land on the opposite of what the user saw.
 */
export async function setHabitDayAction(
  habitId: string,
  done: boolean,
  on?: string,
): Promise<Result> {
  const userId = await requireUserId();
  try {
    await setCompletion(userId, habitId, done, on);
    refresh(habitId);
    return {};
  } catch (error) {
    return failure(error);
  }
}
