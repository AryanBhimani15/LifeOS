import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { instantInZone, todayInZone } from "@/lib/dates";
import { mobileCalendar, mobileTaskList, mobileToday, previewMobileTaskCapture } from "@/lib/repositories/mobile";
import { resetDatabase, makeTwoUsers } from "./helpers/factories";

beforeEach(async () => {
  await resetDatabase();
});

describe("mobile projections", () => {
  it("returns only the signed-in user's Today task data", async () => {
    const { alice, bob } = await makeTwoUsers();
    const today = todayInZone("Europe/London");
    await db.task.createMany({
      data: [
        { userId: alice.id, title: "Alice today", dueAt: instantInZone(today, 10 * 60, "Europe/London"), dueHasTime: true },
        { userId: bob.id, title: "Bob private", dueAt: instantInZone(today, 10 * 60, "Europe/London"), dueHasTime: true },
      ],
    });

    const result = await mobileToday(alice.id);
    expect(result.tasks.map((task) => task.title)).toEqual(["Alice today"]);
    expect(result.user.id).toBe(alice.id);
  });

  it("uses the canonical parser in the user's timezone", async () => {
    const { alice } = await makeTwoUsers();
    const preview = await previewMobileTaskCapture(alice.id, "submit DBMS CIA 2 tomorrow at 10am");
    expect(preview.title).toBe("submit DBMS CIA 2");
    expect(preview.dueAt).not.toBeNull();
    expect(preview.dueHasTime).toBe(true);
    expect(preview.matchedText).toContain("tomorrow");
  });

  it("reads the same source items through the calendar projection", async () => {
    const { alice } = await makeTwoUsers();
    await db.event.create({
      data: {
        userId: alice.id,
        title: "DBMS CIA 2",
        kind: "EXAM",
        startAt: new Date("2026-08-18T04:30:00.000Z"),
        endAt: new Date("2026-08-18T06:00:00.000Z"),
      },
    });
    const result = await mobileCalendar(alice.id, "2026-08-18");
    expect(result.items.some((item) => item.title === "DBMS CIA 2" && item.kind === "exam")).toBe(true);
  });

  it("maps the native Today filter onto the canonical task query", async () => {
    const { alice } = await makeTwoUsers();
    const today = todayInZone("Europe/London");
    await db.task.createMany({
      data: [
        { userId: alice.id, title: "Due today", dueAt: instantInZone(today, 9 * 60, "Europe/London"), dueHasTime: true },
        { userId: alice.id, title: "Later", dueAt: instantInZone(today, 9 * 60, "Europe/London") },
      ],
    });
    const result = await mobileTaskList(alice.id, { filter: "today", search: "" });
    expect(result.items.map((task) => task.title)).toEqual(["Due today", "Later"]);
  });
});
