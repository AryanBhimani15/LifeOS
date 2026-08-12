import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  addAttachment,
  createEvent,
  deleteEvent,
  getEvent,
  listUpcomingEvents,
  removeAttachment,
} from "@/lib/repositories/events";
import { isAllowedType, storage } from "@/lib/storage";
import { makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";

/**
 * Events and their attachments.
 *
 * The attachment tests care about two things above all: that a file belongs to
 * exactly one person, and that a failure never leaves the event damaged. Those
 * are the properties a user would never notice working and would never forgive
 * breaking.
 */

const hour = 3_600_000;

async function makeExam(userId: string, title = "DBMS CIA 2") {
  const start = new Date(Date.now() + 24 * hour);
  return createEvent(userId, {
    title,
    kind: "EXAM",
    startAt: start,
    endAt: new Date(start.getTime() + 1.5 * hour),
    location: "Room 304, Block B",
  });
}

const pdf = (name = "syllabus.pdf") => ({
  filename: name,
  mimeType: "application/pdf",
  body: Buffer.from("%PDF-1.4 fake but plausible"),
});

beforeEach(async () => {
  await resetDatabase();
});

describe("events", () => {
  it("keeps a start and an end rather than a single due date", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);

    const detail = await getEvent(user.id, event.id);
    expect(detail.kind).toBe("EXAM");
    expect(detail.endAt.getTime()).toBeGreaterThan(detail.startAt.getTime());
    expect(detail.location).toBe("Room 304, Block B");
  });

  it("refuses an event that ends before it starts", async () => {
    const user = await makeUser();
    const start = new Date();
    await expect(
      createEvent(user.id, {
        title: "Backwards",
        startAt: start,
        endAt: new Date(start.getTime() - hour),
      }),
    ).rejects.toThrow(AppError);
  });

  it("is fine with no notes, no tasks and no attachments", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id, "Bare event");

    const detail = await getEvent(user.id, event.id);
    expect(detail.description).toBeNull();
    expect(detail.documents).toHaveLength(0);
    expect(detail.prepTasks).toHaveLength(0);
  });

  it("does not show one user's events to another", async () => {
    const { alice, bob } = await makeTwoUsers();
    const event = await makeExam(alice.id);

    await expect(getEvent(bob.id, event.id)).rejects.toThrow(AppError);
    expect(await listUpcomingEvents(bob.id)).toHaveLength(0);
    expect(await listUpcomingEvents(alice.id)).toHaveLength(1);
  });

  it("lists only events that have not started", async () => {
    const user = await makeUser();
    const past = new Date(Date.now() - 5 * hour);
    await db.event.create({
      data: { userId: user.id, title: "Yesterday", startAt: past, endAt: past },
    });
    await makeExam(user.id, "Coming up");

    const upcoming = await listUpcomingEvents(user.id);
    expect(upcoming.map((e) => e.title)).toEqual(["Coming up"]);
  });
});

describe("attachments", () => {
  it("stores the file and records its metadata", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);

    const doc = await addAttachment(user.id, event.id, pdf());

    expect(doc.name).toBe("syllabus.pdf");
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.sizeBytes).toBeGreaterThan(0);

    // And the bytes are really there, readable through the storage layer.
    const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    const bytes = await storage().get(row.storageKey);
    expect(bytes.toString()).toContain("%PDF");
  });

  it("belongs to its event and survives being read back", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);
    await addAttachment(user.id, event.id, pdf("one.pdf"));
    await addAttachment(user.id, event.id, pdf("two.pdf"));

    const detail = await getEvent(user.id, event.id);
    expect(detail.documents.map((d) => d.name)).toEqual(["one.pdf", "two.pdf"]);
  });

  it("never attaches to an event that is not yours", async () => {
    const { alice, bob } = await makeTwoUsers();
    const event = await makeExam(alice.id);

    await expect(addAttachment(bob.id, event.id, pdf())).rejects.toThrow(AppError);
    expect(await db.document.count()).toBe(0);
  });

  it("cannot be removed by another user", async () => {
    const { alice, bob } = await makeTwoUsers();
    const event = await makeExam(alice.id);
    const doc = await addAttachment(alice.id, event.id, pdf());

    await expect(removeAttachment(bob.id, doc.id)).rejects.toThrow(AppError);
    expect(await db.document.count({ where: { id: doc.id } })).toBe(1);

    await removeAttachment(alice.id, doc.id);
    expect(await db.document.count({ where: { id: doc.id } })).toBe(0);
  });

  it("leaves the event intact when an upload is rejected", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);
    await addAttachment(user.id, event.id, pdf("good.pdf"));

    // A missing event id is the failure an upload most plausibly hits.
    await expect(addAttachment(user.id, "no-such-event", pdf("bad.pdf"))).rejects.toThrow(AppError);

    const detail = await getEvent(user.id, event.id);
    expect(detail.title).toBe("DBMS CIA 2");
    expect(detail.documents).toHaveLength(1);
  });

  it("goes with the event when the event is deleted", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);
    await addAttachment(user.id, event.id, pdf());

    await deleteEvent(user.id, event.id);

    expect(await db.document.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.event.count({ where: { userId: user.id } })).toBe(0);
  });

  /**
   * The storage key is generated server-side precisely so a filename can never
   * become a path. This is the test that says so out loud.
   */
  it("does not let a filename influence where the file lands", async () => {
    const user = await makeUser();
    const event = await makeExam(user.id);

    const doc = await addAttachment(user.id, event.id, {
      filename: "../../../../etc/passwd",
      mimeType: "application/pdf",
      body: Buffer.from("nope"),
    });

    const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.storageKey).not.toContain("..");
    expect(row.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]+\.pdf$/);
    // The original name is kept, but only ever as a label.
    expect(row.name).toBe("../../../../etc/passwd");
  });

  it("accepts documents and images but not executables or html", () => {
    expect(isAllowedType("application/pdf")).toBe(true);
    expect(isAllowedType("image/png")).toBe(true);
    // Served from our own origin, an uploaded page would be stored XSS.
    expect(isAllowedType("text/html")).toBe(false);
    expect(isAllowedType("application/x-msdownload")).toBe(false);
    expect(isAllowedType("application/octet-stream")).toBe(false);
  });
});
