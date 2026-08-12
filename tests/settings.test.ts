import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getPalette, getSettings, updateSettings } from "@/lib/repositories/settings";
import { updateSettingsSchema } from "@/lib/validation/settings";
import { listHabits, createHabit, setCompletion } from "@/lib/repositories/habits";
import { todayInZone } from "@/lib/dates";
import { makeUser, resetDatabase } from "./helpers/factories";

/**
 * Settings.
 *
 * The point of these is that a setting is not a stored string — it changes what
 * the rest of the product does. So as well as reading a value back, the tests
 * check that changing the timezone moves which day a habit tick lands on, which
 * is the failure someone would actually notice.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe("reading settings", () => {
  it("returns the account's name and email alongside the preferences", async () => {
    const user = await makeUser({ name: "Aryan" });
    const settings = await getSettings(user.id);

    expect(settings.name).toBe("Aryan");
    expect(settings.email).toBe(user.email);
    expect(settings.timezone).toBe("Europe/London");
  });

  it("falls back to defaults for an account with no settings row", async () => {
    const user = await makeUser();
    await db.userSettings.deleteMany({ where: { userId: user.id } });

    const settings = await getSettings(user.id);
    expect(settings.timezone).toBe("UTC");
    expect(settings.weekStartsOn).toBe(1);
    expect(settings.aiEnabled).toBe(true);
  });
});

describe("changing settings", () => {
  it("saves each field and reads it straight back", async () => {
    const user = await makeUser();

    await updateSettings(user.id, {
      name: "Aryan B",
      timezone: "Asia/Kolkata",
      weekStartsOn: 0,
      currency: "INR",
      palette: "forest",
      aiEnabled: false,
    });

    const settings = await getSettings(user.id);
    expect(settings).toMatchObject({
      name: "Aryan B",
      timezone: "Asia/Kolkata",
      weekStartsOn: 0,
      currency: "INR",
      palette: "forest",
      aiEnabled: false,
    });
  });

  it("leaves untouched fields alone", async () => {
    const user = await makeUser({ name: "Original" });
    await updateSettings(user.id, { timezone: "Asia/Kolkata" });

    const settings = await getSettings(user.id);
    expect(settings.name).toBe("Original");
    expect(settings.weekStartsOn).toBe(1);
  });

  /** An empty name falls back to a greeting rather than rendering "Good evening, ." */
  it("stores an empty name as nothing at all", async () => {
    const user = await makeUser({ name: "Someone" });
    await updateSettings(user.id, { name: "   " });

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.name).toBeNull();
  });

  it("creates a settings row for an account that somehow lacks one", async () => {
    const user = await makeUser();
    await db.userSettings.deleteMany({ where: { userId: user.id } });

    await updateSettings(user.id, { timezone: "Asia/Kolkata" });
    expect((await getSettings(user.id)).timezone).toBe("Asia/Kolkata");
  });

  it("records the change in the audit log, without copying the values", async () => {
    const user = await makeUser();
    await updateSettings(user.id, { timezone: "Asia/Kolkata", currency: "INR" });

    const entry = await db.auditLog.findFirst({
      where: { userId: user.id, action: "SETTINGS_CHANGE" },
    });
    expect(entry).toBeTruthy();
    expect(entry?.summary).toContain("timezone");
    expect(JSON.stringify(entry?.metadata)).not.toContain("Asia/Kolkata");
  });
});

describe("validation", () => {
  it("refuses a timezone the runtime does not know", () => {
    expect(updateSettingsSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ timezone: "Asia/Kolkata" }).success).toBe(true);
  });

  it("refuses a week start outside the week, and a bad currency", () => {
    expect(updateSettingsSchema.safeParse({ weekStartsOn: 9 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ currency: "rupees" }).success).toBe(false);
    expect(updateSettingsSchema.parse({ currency: "inr" }).currency).toBe("INR");
  });

  it("only allows a palette that exists", () => {
    expect(updateSettingsSchema.safeParse({ palette: "neon" }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ palette: "forest" }).success).toBe(true);
  });
});

describe("the palette is a choice, not a guess", () => {
  /**
   * It used to be derived from the user's sex. This is the test that stops that
   * coming back: two accounts differing only in sex must look identical.
   */
  it("does not depend on the fitness profile", async () => {
    const male = await makeUser();
    const female = await makeUser();
    await db.fitnessProfile.create({
      data: { userId: male.id, firstName: "A", age: 30, sex: "MALE", heightMm: 1780, weightGrams: 75_000, activityLevel: "MODERATELY_ACTIVE", completedAt: new Date() },
    });
    await db.fitnessProfile.create({
      data: { userId: female.id, firstName: "B", age: 30, sex: "FEMALE", heightMm: 1650, weightGrams: 60_000, activityLevel: "MODERATELY_ACTIVE", completedAt: new Date() },
    });

    expect(await getPalette(male.id)).toBe(await getPalette(female.id));
  });

  it("returns what was chosen, and a sane default otherwise", async () => {
    const user = await makeUser();
    expect(await getPalette(user.id)).toBe("rose");

    await updateSettings(user.id, { palette: "forest" });
    expect(await getPalette(user.id)).toBe("forest");
  });
});

describe("settings actually change behaviour", () => {
  /**
   * The reason the timezone field matters. A habit ticked "today" in one zone
   * is a different calendar day in another, and getting this wrong silently
   * breaks every streak in the product.
   */
  it("changing the timezone changes which day counts as today", async () => {
    const user = await makeUser();
    await updateSettings(user.id, { timezone: "Pacific/Kiritimati" }); // UTC+14

    const habit = await createHabit(user.id, {
      name: "Read",
      cadence: "DAILY",
      byWeekday: [],
      targetPerWeek: 7,
      category: "MIND",
    });
    await setCompletion(user.id, habit.id, true);

    const ahead = await listHabits(user.id, { category: "ALL", view: "today" });
    expect(ahead.today).toBe(todayInZone("Pacific/Kiritimati"));
    expect(ahead.habits[0].doneToday).toBe(true);

    // Move the account west; "today" is now a different date for the same rows.
    await updateSettings(user.id, { timezone: "Pacific/Midway" }); // UTC-11
    const behind = await listHabits(user.id, { category: "ALL", view: "today" });
    expect(behind.today).toBe(todayInZone("Pacific/Midway"));
    expect(behind.today).not.toBe(ahead.today);
  });

  it("changing the week start changes where a weekly streak begins", async () => {
    const user = await makeUser();
    await updateSettings(user.id, { weekStartsOn: 0 });
    expect((await listHabits(user.id, { category: "ALL", view: "today" })).weekStartsOn).toBe(0);

    await updateSettings(user.id, { weekStartsOn: 1 });
    expect((await listHabits(user.id, { category: "ALL", view: "today" })).weekStartsOn).toBe(1);
  });
});
