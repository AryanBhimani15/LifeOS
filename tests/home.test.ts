import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addCalendarDays, instantInZone, todayInZone } from "@/lib/dates";
import { createEvent } from "@/lib/repositories/events";
import { getHomeData, rankHomeUpcoming, type HomeUpcomingCandidate } from "@/lib/repositories/home";
import { makeTwoUsers, makeUser, resetDatabase } from "./helpers/factories";

beforeEach(async () => {
  await resetDatabase();
});

describe("Home upcoming ranking", () => {
  const now = new Date("2026-08-14T09:00:00.000Z");
  const candidate = (partial: Partial<HomeUpcomingCandidate>): HomeUpcomingCandidate => ({
    id: partial.id ?? "item",
    title: partial.title ?? "Item",
    source: partial.source ?? "event",
    kind: partial.kind ?? "EVENT",
    at: partial.at ?? new Date("2026-08-14T10:00:00.000Z"),
    allDay: partial.allDay ?? false,
    href: partial.href ?? "/events/item",
    ...partial,
  });

  it("puts an upcoming exam before a closer low-stakes event", () => {
    const winner = rankHomeUpcoming([
      candidate({ id: "event", at: new Date("2026-08-14T09:10:00.000Z") }),
      candidate({ id: "exam", kind: "EXAM", at: new Date("2026-08-16T09:00:00.000Z") }),
    ], now);
    expect(winner?.id).toBe("exam");
    expect(winner?.label).toBe("Next exam");
  });

  it("puts overdue work before an ordinary near event and resolves ties stably", () => {
    const winner = rankHomeUpcoming([
      candidate({ id: "event", at: new Date("2026-08-14T09:10:00.000Z") }),
      candidate({ id: "overdue", source: "task", kind: "TASK", at: new Date("2026-08-13T09:00:00.000Z"), priority: "HIGH", href: "/tasks?focus=overdue" }),
    ], now);
    expect(winner?.id).toBe("overdue");
    expect(winner?.label).toBe("Overdue work");
  });
});

describe("Home loader", () => {
  async function homeToday(userId: string) {
    const settings = await db.userSettings.findUniqueOrThrow({ where: { userId }, select: { timezone: true } });
    return { zone: settings.timezone, today: todayInZone(settings.timezone) };
  }

  it("shows only the signed-in user's task, note, and calendar records", async () => {
    const { alice, bob } = await makeTwoUsers();
    const { zone, today } = await homeToday(alice.id);
    await db.task.create({ data: { userId: alice.id, title: "Alice private task", dueAt: instantInZone(today, 9 * 60, zone), dueHasTime: true } });
    await db.note.create({ data: { userId: alice.id, title: "A quick note", content: "This must persist on Home." } });

    const bobHome = await getHomeData(bob.id);
    expect(bobHome.todayTasks).toHaveLength(0);
    expect(bobHome.notes).toHaveLength(0);
    expect(bobHome.week).toHaveLength(0);

    const aliceHome = await getHomeData(alice.id);
    expect(aliceHome.todayTasks.map((task) => task.title)).toContain("Alice private task");
    expect(aliceHome.notes.map((note) => note.title)).toContain("A quick note");
  });

  it("uses real source objects in the week preview without duplicate records", async () => {
    const user = await makeUser();
    const { zone, today } = await homeToday(user.id);
    const task = await db.task.create({ data: { userId: user.id, title: "Submit report", dueAt: instantInZone(today, 10 * 60, zone), dueHasTime: true } });
    await createEvent(user.id, {
      title: "DBMS CIA 2",
      kind: "EXAM",
      startAt: instantInZone(addCalendarDays(today, 1), 10 * 60, zone),
      endAt: instantInZone(addCalendarDays(today, 1), 11 * 60, zone),
    });

    const home = await getHomeData(user.id);
    expect(home.week.find((item) => item.key === `task:${task.id}`)?.href).toBe(`/tasks?focus=${task.id}`);
    expect(new Set(home.week.map((item) => item.key)).size).toBe(home.week.length);
    expect(home.week.some((item) => item.kind === "exam")).toBe(true);
  });
});
