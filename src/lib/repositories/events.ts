import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { recomputeRelativeEventReminders } from "@/lib/repositories/reminders";
import type { EventKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Events, and everything that hangs off one.
 *
 * An event is the richer sibling of a task: it *happens* between two times
 * rather than being *due* at one. The distinction already existed in the schema
 * (`Event.startAt`/`endAt` versus `Task.dueAt`). Preparation work is connected
 * through an explicit junction so it remains a normal task and is never copied
 * or deleted just because its event changes.
 *
 * Every relationship is optional, in both directions. An event with no notes,
 * no preparation tasks and no attachments is a perfectly ordinary event, and
 * the detail page is built to render exactly that without looking broken.
 */

const EVENT_DETAIL = {
  id: true,
  title: true,
  description: true,
  location: true,
  kind: true,
  startAt: true,
  endAt: true,
  allDay: true,
  createdAt: true,
  project: { select: { id: true, name: true, color: true } },
  preparationTasks: {
    select: {
      task: { select: { id: true, title: true, status: true, dueAt: true, dueHasTime: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  notes: {
    select: { id: true, title: true, content: true, pinned: true, updatedAt: true },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 8,
  },
  documents: {
    select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  reminders: { select: { id: true, remindAt: true, relativeMinutesBefore: true }, orderBy: { remindAt: "asc" }, take: 1 },
} satisfies Prisma.EventSelect;

export type EventDetail = NonNullable<Awaited<ReturnType<typeof getEvent>>>;

export async function getEvent(userId: string, id: string) {
  const event = await db.event.findFirst({
    where: { id, userId },
    select: EVENT_DETAIL,
  });
  if (!event) throw notFound("Event");

  return { ...event, prepTasks: event.preparationTasks.map(({ task }) => task) };
}

const UPCOMING_SELECT = {
  id: true,
  title: true,
  kind: true,
  startAt: true,
  endAt: true,
  allDay: true,
  location: true,
} as const;

/** Upcoming events, nearest first, already-started excluded. */
export function listUpcomingEvents(userId: string, limit = 3) {
  return db.event.findMany({
    where: { userId, isTemplate: false, startAt: { gte: new Date() } },
    select: UPCOMING_SELECT,
    orderBy: { startAt: "asc" },
    take: limit,
  });
}

/** A bounded option list for relationship pickers, not a global event search. */
export function listEventRelationshipChoices(userId: string, limit = 40) {
  return db.event.findMany({
    where: { userId, isTemplate: false },
    select: { id: true, title: true, kind: true, startAt: true, allDay: true },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

export function listTaskRelationshipChoices(userId: string, limit = 40) {
  return db.task.findMany({
    where: { userId, isTemplate: false, status: { not: "CANCELLED" } },
    select: { id: true, title: true, status: true, dueAt: true, dueHasTime: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

export function listUnrelatedNoteChoices(userId: string, limit = 40) {
  return db.note.findMany({
    where: { userId, eventId: null },
    select: { id: true, title: true, content: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

/**
 * The one event worth putting on the Home page.
 *
 * An exam within the next fortnight outranks anything else, even something
 * sooner. A stand-up in an hour is not what someone needs reminding of; the
 * exam on Thursday is, and burying it under today's meetings is how it gets
 * forgotten. Beyond that horizon the nearest event simply wins.
 */
export async function getHeadlineEvent(userId: string) {
  const now = new Date();
  const fortnight = new Date(now.getTime() + 14 * 24 * 3_600_000);

  const exam = await db.event.findFirst({
    where: {
      userId,
      isTemplate: false,
      kind: "EXAM",
      startAt: { gte: now, lte: fortnight },
    },
    select: UPCOMING_SELECT,
    orderBy: { startAt: "asc" },
  });
  if (exam) return exam;

  return db.event.findFirst({
    where: { userId, isTemplate: false, startAt: { gte: now } },
    select: UPCOMING_SELECT,
    orderBy: { startAt: "asc" },
  });
}

export interface CreateEventInput {
  title: string;
  kind?: EventKind;
  startAt: Date;
  endAt: Date;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  tagNames?: string[];
}

export async function createEvent(userId: string, input: CreateEventInput) {
  if (input.endAt < input.startAt) {
    throw badRequest("An event cannot end before it starts.");
  }

  const tagNames = [...new Set((input.tagNames ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 6);
  return db.event.create({
    data: {
      userId,
      title: input.title,
      kind: input.kind ?? "EVENT",
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay ?? false,
      location: input.location ?? null,
      description: input.description ?? null,
      ...(tagNames.length
        ? {
            tags: {
              create: tagNames.map((name) => ({
                tag: { connectOrCreate: { where: { userId_name: { userId, name } }, create: { userId, name, color: "#ed3970" } } },
              })),
            },
          }
        : {}),
    },
    select: { id: true, title: true, kind: true, startAt: true, endAt: true },
  });
}

export async function updateEvent(
  userId: string,
  id: string,
  patch: Partial<CreateEventInput>,
) {
  const existing = await db.event.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw notFound("Event");

  return db.$transaction(async (tx) => {
    const event = await tx.event.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
        ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
      },
      select: { id: true, title: true, startAt: true },
    });
    if (patch.startAt !== undefined) {
      await recomputeRelativeEventReminders(tx, id, event.startAt);
    }
    return { id: event.id, title: event.title };
  });
}

export async function deleteEvent(userId: string, id: string): Promise<void> {
  // Attachments cascade with the row; their bytes are removed first, because a
  // deleted row is unrecoverable but an orphaned file is invisible rubbish.
  const documents = await db.document.findMany({
    where: { eventId: id, userId },
    select: { storageKey: true },
  });

  const { count } = await db.event.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Event");

  await Promise.all(
    documents.map((doc) =>
      storage()
        .remove(doc.storageKey)
        .catch((error) => {
          // The row is already gone; a failed unlink must not resurrect it.
          console.error(`[storage] could not remove ${doc.storageKey}`, error);
        }),
    ),
  );
}

/** Links an existing normal task to an event as preparation. Both rows must be
 * owned by the same caller; the junction only carries context, never task data. */
export async function linkTaskToEvent(userId: string, eventId: string, taskId: string) {
  const [event, task] = await Promise.all([
    db.event.findFirst({ where: { id: eventId, userId }, select: { id: true } }),
    db.task.findFirst({ where: { id: taskId, userId }, select: { id: true } }),
  ]);
  if (!event || !task) throw notFound("Event");

  await db.eventPreparationTask.upsert({
    where: { eventId_taskId: { eventId, taskId } },
    create: { eventId, taskId },
    update: {},
  });
}

export async function unlinkTaskFromEvent(userId: string, eventId: string, taskId: string) {
  const link = await db.eventPreparationTask.findFirst({
    where: { eventId, taskId, event: { userId }, task: { userId } },
    select: { eventId: true, taskId: true },
  });
  if (!link) throw notFound("Preparation task");
  await db.eventPreparationTask.delete({ where: { eventId_taskId: link } });
}

/** Creates one ordinary saved note, already related to this event. */
export async function createEventNote(userId: string, eventId: string, content: string) {
  const event = await db.event.findFirst({ where: { id: eventId, userId }, select: { id: true } });
  if (!event) throw notFound("Event");
  const body = content.trim();
  if (!body) throw badRequest("Write a note first.");
  return db.note.create({
    data: { userId, eventId, title: body.split(/[.\n]/)[0]!.slice(0, 200), content: body },
    select: { id: true, title: true, content: true, updatedAt: true },
  });
}

/** Connect or disconnect a persisted Note without duplicating/deleting it. */
export async function setNoteEvent(userId: string, noteId: string, eventId: string | null) {
  const note = await db.note.findFirst({ where: { id: noteId, userId }, select: { id: true } });
  if (!note) throw notFound("Note");
  if (eventId) {
    const event = await db.event.findFirst({ where: { id: eventId, userId }, select: { id: true } });
    if (!event) throw notFound("Event");
  }
  return db.note.update({ where: { id: note.id }, data: { eventId }, select: { id: true, eventId: true } });
}

export { setEventReminder } from "@/lib/repositories/reminders";

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  body: Buffer;
}

/**
 * Stores a file and records it against the event.
 *
 * The bytes are written first and the row second. If the write fails there is
 * no row, and if the row fails the orphaned bytes are cleaned up — either way
 * the event itself is untouched, which is what "a failed upload must not
 * corrupt the event" means in practice.
 */
export async function addAttachment(userId: string, eventId: string, file: AttachmentInput) {
  const event = await db.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true },
  });
  if (!event) throw notFound("Event");

  const stored = await storage().put({
    body: file.body,
    contentType: file.mimeType,
    filename: file.filename,
  });

  try {
    return await db.document.create({
      data: {
        userId,
        eventId,
        // The original name is kept for display only; it is never a path.
        name: file.filename.slice(0, 255),
        mimeType: file.mimeType,
        sizeBytes: stored.size,
        storageKey: stored.key,
      },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
  } catch (error) {
    await storage()
      .remove(stored.key)
      .catch(() => {});
    throw error;
  }
}

/** Same private Azure-backed resource pipeline, attached to a normal task. */
export async function addTaskAttachment(userId: string, taskId: string, file: AttachmentInput) {
  const task = await db.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
  if (!task) throw notFound("Task");

  const stored = await storage().put({
    body: file.body,
    contentType: file.mimeType,
    filename: file.filename,
  });

  try {
    return await db.document.create({
      data: {
        userId,
        taskId,
        name: file.filename.slice(0, 255),
        mimeType: file.mimeType,
        sizeBytes: stored.size,
        storageKey: stored.key,
      },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
  } catch (error) {
    await storage().remove(stored.key).catch(() => {});
    throw error;
  }
}

export async function getAttachment(userId: string, id: string) {
  const doc = await db.document.findFirst({
    where: { id, userId },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, storageKey: true },
  });
  if (!doc) throw notFound("Attachment");
  return doc;
}

export async function removeAttachment(userId: string, id: string): Promise<void> {
  const doc = await db.document.findFirst({
    where: { id, userId },
    select: { id: true, storageKey: true },
  });
  if (!doc) throw notFound("Attachment");

  await db.document.delete({ where: { id: doc.id } });
  await storage()
    .remove(doc.storageKey)
    .catch((error) => console.error(`[storage] could not remove ${doc.storageKey}`, error));
}
