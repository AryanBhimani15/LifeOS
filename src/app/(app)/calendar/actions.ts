"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { instantInZone } from "@/lib/dates";
import { createEvent } from "@/lib/repositories/events";
import { calendarSettings, rescheduleItem } from "@/lib/repositories/calendar";
import {
  createCalendarEventSchema,
  rescheduleSchema,
} from "@/lib/validation/calendar";

/**
 * Server actions for the calendar.
 *
 * There are only two, and that is the point: create an *event*, and move
 * something that already exists. Everything else on the calendar is created by
 * the feature that owns it.
 */

type Result = { error?: string };

function failure(error: unknown): Result {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? "That does not look right." };
  }
  if (error instanceof AppError) return { error: error.message };
  throw error;
}

/** Everything the calendar can put an item on has to be told it moved. */
function refreshAll() {
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/tasks");
  revalidatePath("/exams");
  revalidatePath("/goals");
}

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
};

export async function createCalendarEventAction(input: unknown): Promise<Result & { id?: string }> {
  const userId = await requireUserId();
  try {
    const body = createCalendarEventSchema.parse(input);
    const { zone } = await calendarSettings(userId);

    // Wall-clock times are turned into instants in the user's own zone, so
    // "14:00 on the 15th" means two in the afternoon where they are.
    const startAt = body.allDay
      ? instantInZone(body.date, 0, zone)
      : instantInZone(body.date, minutesOf(body.startTime!), zone);
    const endAt = body.allDay
      ? instantInZone(body.date, 23 * 60 + 59, zone)
      : body.endTime
        ? instantInZone(body.date, minutesOf(body.endTime), zone)
        : new Date(startAt.getTime() + 3_600_000);

    const event = await createEvent(userId, {
      title: body.title,
      kind: "EVENT",
      startAt,
      endAt,
      allDay: body.allDay,
      location: body.location ?? null,
      description: body.notes ?? null,
    });

    if (body.remindMinutesBefore != null) {
      await db.reminder.create({
        data: {
          userId,
          eventId: event.id,
          remindAt: new Date(startAt.getTime() - body.remindMinutesBefore * 60_000),
        },
      });
    }

    refreshAll();
    return { id: event.id };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Moves an item to another day.
 *
 * Delegates straight to the repository, which edits the row the item came from.
 * Nothing here creates anything, so a mis-drag is undone by dragging back.
 */
export async function rescheduleAction(input: unknown): Promise<Result> {
  const userId = await requireUserId();
  try {
    const { kind, sourceId, day } = rescheduleSchema.parse(input);
    await rescheduleItem(userId, kind, sourceId, day);
    refreshAll();
    return {};
  } catch (error) {
    return failure(error);
  }
}
