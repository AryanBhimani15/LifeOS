import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationCenter,
  processDueReminders,
} from "@/lib/repositories/notifications";
import { setEventReminder, updateEvent } from "@/lib/repositories/events";
import { setTaskReminder } from "@/lib/repositories/reminders";
import { makeTask, makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";

beforeEach(async () => {
  await resetDatabase();
});

describe("reliable in-app reminder delivery", () => {
  it("delivers a due task reminder once and excludes future/cancelled reminders", async () => {
    const user = await makeUser();
    const [due, future, cancelled] = await Promise.all([
      makeTask(user.id, { title: "Submit DBMS assignment" }),
      makeTask(user.id, { title: "Later" }),
      makeTask(user.id, { title: "Cancelled" }),
    ]);
    const now = new Date("2026-08-14T12:00:00.000Z");
    await db.reminder.createMany({ data: [
      { userId: user.id, taskId: due.id, remindAt: new Date(now.getTime() - 60_000) },
      { userId: user.id, taskId: future.id, remindAt: new Date(now.getTime() + 60_000) },
      { userId: user.id, taskId: cancelled.id, remindAt: new Date(now.getTime() - 60_000), status: "CANCELLED" },
    ] });

    expect(await processDueReminders({ now })).toMatchObject({ delivered: 1 });
    expect(await processDueReminders({ now })).toMatchObject({ delivered: 0 });

    const notifications = await db.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ title: "Submit DBMS assignment", href: `/tasks?focus=${due.id}` });
    expect(await db.reminder.findFirstOrThrow({ where: { taskId: due.id } })).toMatchObject({ status: "DELIVERED" });
    expect(await db.reminder.findFirstOrThrow({ where: { taskId: future.id } })).toMatchObject({ status: "PENDING" });
    expect(await db.reminder.findFirstOrThrow({ where: { taskId: cancelled.id } })).toMatchObject({ status: "CANCELLED" });
  });

  it("has an idempotency barrier when workers overlap", async () => {
    const user = await makeUser();
    const task = await makeTask(user.id, { title: "One alert only" });
    const now = new Date("2026-08-14T12:00:00.000Z");
    await db.reminder.create({ data: { userId: user.id, taskId: task.id, remindAt: new Date(now.getTime() - 1) } });

    await Promise.all([processDueReminders({ now }), processDueReminders({ now })]);
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("scopes notifications, read actions, and deep links to their owner", async () => {
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id, { title: "Alice private task" });
    const now = new Date("2026-08-14T12:00:00.000Z");
    await db.reminder.create({ data: { userId: alice.id, taskId: task.id, remindAt: now } });
    await processDueReminders({ now });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: alice.id } });

    expect((await notificationCenter(alice.id)).items[0]).toMatchObject({ href: `/tasks?focus=${task.id}` });
    expect(await notificationCenter(bob.id)).toMatchObject({ items: [], unread: 0 });
    await markNotificationRead(bob.id, notification.id);
    expect((await notificationCenter(alice.id)).unread).toBe(1);
    await markNotificationRead(alice.id, notification.id);
    expect((await notificationCenter(alice.id)).unread).toBe(0);
    await markAllNotificationsRead(alice.id);
  });

  it("keeps a task reminder independent from a task due date", async () => {
    const user = await makeUser();
    const task = await makeTask(user.id, { title: "Call tutor" });
    const when = new Date("2026-08-14T18:00:00.000Z");
    await setTaskReminder(user.id, task.id, when);

    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ dueAt: null });
    expect(await db.reminder.findFirstOrThrow({ where: { taskId: task.id } })).toMatchObject({ remindAt: when, status: "PENDING" });
  });

  it("recomputes a relative event reminder when an event moves across a date boundary", async () => {
    const user = await makeUser();
    const originalStart = new Date("2026-03-08T23:30:00.000Z");
    const event = await db.event.create({ data: { userId: user.id, title: "DST-aware event", startAt: originalStart, endAt: new Date(originalStart.getTime() + 3_600_000) } });
    await setEventReminder(user.id, event.id, { relativeMinutesBefore: 60 });
    const movedStart = new Date("2026-03-09T01:30:00.000Z");

    await updateEvent(user.id, event.id, { startAt: movedStart, endAt: new Date(movedStart.getTime() + 3_600_000) });
    expect(await db.reminder.findFirstOrThrow({ where: { eventId: event.id } })).toMatchObject({
      relativeMinutesBefore: 60,
      remindAt: new Date("2026-03-09T00:30:00.000Z"),
      status: "PENDING",
    });
  });

  it("does not deliver a reminder whose source was deleted", async () => {
    const user = await makeUser();
    const task = await makeTask(user.id, { title: "Delete me first" });
    const now = new Date("2026-08-14T12:00:00.000Z");
    await db.reminder.create({ data: { userId: user.id, taskId: task.id, remindAt: now } });
    await db.task.delete({ where: { id: task.id } });

    expect(await processDueReminders({ now })).toMatchObject({ delivered: 0 });
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(0);
  });
});
