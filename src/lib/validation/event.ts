import { z } from "zod";
import { idSchema, isoDateTime, longText, title } from "./common";

/** Validation for events. Kinds mirror the Prisma enum. */
export const eventKind = z.enum(["EVENT", "EXAM", "CLASS", "MEETING", "DEADLINE"]);

export const createEventSchema = z
  .object({
    title: title(200),
    kind: eventKind.default("EVENT"),
    startAt: isoDateTime,
    endAt: isoDateTime,
    allDay: z.boolean().default(false),
    location: z.string().trim().max(200).nullish(),
    description: longText(10_000).nullish(),
  })
  .refine((e) => e.endAt >= e.startAt, {
    message: "An event cannot end before it starts.",
    path: ["endAt"],
  });

export const updateEventSchema = z.object({
  title: title(200).optional(),
  kind: eventKind.optional(),
  startAt: isoDateTime.optional(),
  endAt: isoDateTime.optional(),
  location: z.string().trim().max(200).nullish(),
  description: longText(10_000).nullish(),
});

export const linkTaskSchema = z.object({ taskId: idSchema });

export type CreateEventInput = z.infer<typeof createEventSchema>;
