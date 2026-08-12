"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { updateSettings } from "@/lib/repositories/settings";
import { updateSettingsSchema } from "@/lib/validation/settings";

/**
 * Saving settings.
 *
 * Almost every page reads at least one of these — the timezone decides which
 * day things land on, the palette tints the shell — so the whole signed-in
 * area is revalidated rather than guessing which screens care.
 */
export async function updateSettingsAction(input: unknown): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await updateSettings(userId, updateSettingsSchema.parse(input));
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "That does not look right." };
    }
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
}
