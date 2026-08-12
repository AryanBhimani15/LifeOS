import { z } from "zod";
import { idSchema, isoDate, longText, title } from "./common";
import { CALENDAR_KINDS } from "@/lib/calendar";

/** Validation for the calendar view and the events created from it. */

export const calendarKind = z.enum(CALENDAR_KINDS);

export const calendarQuerySchema = z.object({
  view: z.enum(["month", "week", "day", "agenda"]).default("month"),
  /** The date the view is anchored on. Defaults to today at the repository. */
  date: isoDate.optional(),
  /** Comma-separated kinds. Parsed leniently — see `parseKinds`. */
  kinds: z.string().max(120).optional(),
});

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:30");

/**
 * Creating a calendar event.
 *
 * Only events. A task belongs to the Tasks feature and a habit to Habits, and
 * offering to create either from here would be a second front door to a system
 * that already has one — with its own subtly different rules.
 */
export const createCalendarEventSchema = z
  .object({
    title: title(200),
    date: isoDate,
    startTime: time.optional(),
    endTime: time.optional(),
    allDay: z.boolean().default(false),
    notes: longText(10_000).nullish(),
    location: z.string().trim().max(200).nullish(),
    /**
     * Minutes before the start. Null for no reminder.
     *
     * Stored as an offset rather than an instant so that moving the event moves
     * the reminder with it, instead of leaving it pointing at the old time.
     */
    remindMinutesBefore: z.number().int().min(0).max(10_080).nullish(),
  })
  .refine((event) => event.allDay || event.startTime, {
    message: "Give a start time, or mark it all day.",
    path: ["startTime"],
  })
  .refine(
    (event) => event.allDay || !event.endTime || !event.startTime || event.endTime >= event.startTime,
    { message: "It cannot end before it starts.", path: ["endTime"] },
  );

export const rescheduleSchema = z.object({
  kind: calendarKind,
  sourceId: idSchema,
  day: isoDate,
});

export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;
