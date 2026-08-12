import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ACTIVITY_CATALOGUE } from "../prisma/activities";
import { AppError } from "@/lib/errors";
import { accountExists } from "@/lib/authz";
import {
  calculateBurn,
  cmToMm,
  feetInchesToMm,
  formatDuration,
  formatHeight,
  formatWeight,
  greetingForHour,
  gramsToKg,
  kgToGrams,
  lbToGrams,
  mmToFeetInches,
} from "@/lib/fitness";
import { durationSchema, fitnessProfileSchema } from "@/lib/validation/fitness";
import {
  deleteWorkout,
  getFitnessStats,
  hasCompletedOnboarding,
  listHistory,
  previewBurn,
  saveProfile,
  saveWorkout,
} from "@/lib/repositories/fitness";
import {
  makeFitnessProfile,
  makeTwoUsers,
  makeUser,
  makeWorkout,
  resetDatabase,
} from "./helpers/factories";

/**
 * Fitness: units, arithmetic, validation and isolation.
 *
 * The unit tests here are not ceremony. Height and weight round-trip between
 * two measurement systems on their way to and from the database, and every
 * bug this feature had during development was a rounding or timezone boundary
 * rather than anything to do with React.
 */

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toThrow(AppError);
  await promise.catch((error: unknown) => {
    expect((error as AppError).status).toBe(status);
  });
}

const runningId = () =>
  db.activity.findUniqueOrThrow({ where: { slug: "running" }, select: { id: true } });

beforeEach(async () => {
  await resetDatabase();
});

// ---------------------------------------------------------------------------

describe("activity catalogue", () => {
  /**
   * The rows exist twice — as SQL in a migration, which is what actually
   * populates a deployed database, and as `prisma/activities.ts`, which is what
   * tests restore from. This is the check that stops the two from drifting.
   */
  it("matches the migration that seeds it", () => {
    const dir = join(process.cwd(), "prisma/migrations");
    const sql = readdirSync(dir)
      .filter((name) => !name.endsWith(".toml"))
      .map((name) => readFileSync(join(dir, name, "migration.sql"), "utf8"))
      .join("\n");

    for (const activity of ACTIVITY_CATALOGUE) {
      const row = `('${activity.id}',`;
      expect(sql, `${activity.slug} is missing from the migrations`).toContain(row);
      // The rate is the number the whole feature is built on, so it is checked
      // literally rather than by counting rows.
      const values = new RegExp(
        `\\('${activity.id}',\\s*'${activity.slug}',\\s*'${activity.name}',\\s*'${activity.icon}',\\s*${activity.caloriesPerHour},`,
      );
      expect(sql, `${activity.slug} differs between the migration and prisma/activities.ts`).toMatch(
        values,
      );
    }
  });

  it("is what the API serves", async () => {
    const rows = await db.activity.findMany({ orderBy: { sortOrder: "asc" } });
    expect(rows).toHaveLength(ACTIVITY_CATALOGUE.length);
    expect(rows.map((r) => r.slug)).toEqual(ACTIVITY_CATALOGUE.map((a) => a.slug));
  });
});

describe("burn arithmetic", () => {
  it("prorates the hourly rate", () => {
    expect(calculateBurn(600, 90)).toBe(900);
    expect(calculateBurn(600, 60)).toBe(600);
    expect(calculateBurn(250, 30)).toBe(125);
  });

  it("rounds to a whole calorie", () => {
    // 450 kcal/hr for 7 minutes is 52.5 — a half calorie is not a number to show.
    expect(calculateBurn(450, 7)).toBe(53);
    expect(Number.isInteger(calculateBurn(700, 13))).toBe(true);
  });

  it("formats durations without empty parts", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(135)).toBe("2h 15m");
  });
});

describe("units", () => {
  it("carries inches into feet instead of reporting 5′12″", () => {
    // 71.6 inches rounds to 72, which is six feet exactly.
    expect(mmToFeetInches(1818)).toEqual({ feet: 6, inches: 0 });
    expect(mmToFeetInches(1803)).toEqual({ feet: 5, inches: 11 });
  });

  it("round-trips a height through feet and inches within a centimetre", () => {
    for (let cm = 140; cm <= 210; cm += 1) {
      const { feet, inches } = mmToFeetInches(cmToMm(cm));
      const back = feetInchesToMm(feet, inches) / 10;
      // Worst case is half an inch, 1.27 cm — inches are simply coarser.
      expect(Math.abs(back - cm)).toBeLessThan(1.4);
    }
  });

  it("round-trips a weight through pounds", () => {
    for (let kg = 40; kg <= 150; kg += 5) {
      const lb = Math.round((kgToGrams(kg) / 453.59237) * 10) / 10;
      expect(Math.abs(gramsToKg(lbToGrams(lb)) - kg)).toBeLessThan(0.06);
    }
  });

  it("formats in whichever unit was chosen", () => {
    expect(formatHeight(1780, "cm")).toBe("178 cm");
    expect(formatHeight(1780, "ftin")).toBe("5′ 10″");
    expect(formatWeight(72_000, "kg")).toBe("72 kg");
    expect(formatWeight(72_000, "lb")).toBe("158.7 lb");
  });
});

describe("greeting", () => {
  it("matches the part of the day", () => {
    expect(greetingForHour(3)).toBe("Still up");
    expect(greetingForHour(9)).toBe("Good morning");
    expect(greetingForHour(14)).toBe("Good afternoon");
    expect(greetingForHour(19)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Good night");
  });
});

// ---------------------------------------------------------------------------

describe("duration validation", () => {
  const message = (input: unknown) => {
    const result = durationSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("rejects a zero duration with the message the user should see", () => {
    expect(message({ hours: 0, minutes: 0 })).toBe("Enter a duration greater than 0 minutes.");
  });

  it("rejects negatives", () => {
    expect(message({ hours: -1, minutes: 30 })).toBe("Hours cannot be negative.");
    expect(message({ hours: 0, minutes: -5 })).toBe("Minutes cannot be negative.");
  });

  it("rejects unrealistically long sessions", () => {
    expect(message({ hours: 25, minutes: 0 })).toBe("Enter 24 hours or fewer.");
    expect(message({ hours: 24, minutes: 30 })).toBe(
      "That is longer than a day. Enter 24 hours or less.",
    );
  });

  it("pushes minutes over 59 into the hours field", () => {
    expect(message({ hours: 0, minutes: 90 })).toBe(
      "Enter 59 minutes or fewer — use the hours field for more.",
    );
  });

  it("converts a valid pair to total minutes", () => {
    expect(durationSchema.parse({ hours: 1, minutes: 30 })).toBe(90);
    expect(durationSchema.parse({ hours: 0, minutes: 1 })).toBe(1);
  });
});

describe("profile validation", () => {
  const base = {
    firstName: "Aryan",
    age: 24,
    sex: "MALE" as const,
    height: { unit: "cm" as const, cm: 178 },
    weight: { unit: "kg" as const, value: 72 },
    activityLevel: "MODERATELY_ACTIVE" as const,
    lifeContext: "STUDENT" as const,
    primaryGoal: "BUILD_STRENGTH" as const,
  };

  const message = (input: unknown) => {
    const result = fitnessProfileSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a complete profile and converts to canonical units", () => {
    const parsed = fitnessProfileSchema.parse(base);
    expect(parsed.height).toEqual({ heightMm: 1780, heightUnit: "cm" });
    expect(parsed.weight).toEqual({ weightGrams: 72_000, weightUnit: "kg" });
  });

  it("converts feet and inches to the same canonical millimetres", () => {
    const parsed = fitnessProfileSchema.parse({
      ...base,
      height: { unit: "ftin", feet: 5, inches: 10 },
    });
    expect(parsed.height.heightMm).toBe(1778);
    expect(parsed.height.heightUnit).toBe("ftin");
  });

  it("converts pounds to grams", () => {
    const parsed = fitnessProfileSchema.parse({
      ...base,
      weight: { unit: "lb", value: 160 },
    });
    expect(parsed.weight.weightGrams).toBe(72_575);
  });

  it("requires a name", () => {
    expect(message({ ...base, firstName: "   " })).toBe("Enter your first name.");
  });

  it("bounds the age", () => {
    expect(message({ ...base, age: 8 })).toBe("You need to be at least 13 to use this.");
    expect(message({ ...base, age: 150 })).toBe("Enter an age of 120 or less.");
    expect(message({ ...base, age: 24.5 })).toBe("Enter your age in whole years.");
  });

  it("bounds height and weight in either unit", () => {
    expect(message({ ...base, height: { unit: "cm", cm: 20 } })).toContain("That height looks off");
    expect(message({ ...base, height: { unit: "ftin", feet: 9, inches: 0 } })).toContain(
      "That height looks off",
    );
    expect(message({ ...base, weight: { unit: "kg", value: 5 } })).toContain("That weight looks off");
    expect(message({ ...base, weight: { unit: "lb", value: 1200 } })).toContain(
      "That weight looks off",
    );
  });

  it("requires the choice questions to be answered", () => {
    expect(message({ ...base, sex: null })).toBe("Choose one to continue.");
    expect(message({ ...base, activityLevel: undefined })).toBe(
      "Choose how active you usually are.",
    );
  });
});

// ---------------------------------------------------------------------------

describe("onboarding state", () => {
  it("is incomplete until the profile is saved", async () => {
    const user = await makeUser();
    expect(await hasCompletedOnboarding(user.id)).toBe(false);

    await saveProfile(user.id, fitnessProfileSchema.parse({
      firstName: "Aryan",
      age: 24,
      sex: "MALE",
      height: { unit: "cm", cm: 178 },
      weight: { unit: "kg", value: 72 },
      activityLevel: "VERY_ACTIVE",
      lifeContext: "PROFESSIONAL",
      primaryGoal: "STAY_HEALTHY",
    }));

    expect(await hasCompletedOnboarding(user.id)).toBe(true);
  });

  it("does not count a started-but-abandoned profile as complete", async () => {
    const user = await makeUser();
    await db.fitnessProfile.create({
      data: {
        userId: user.id,
        firstName: "Half",
        age: 30,
        sex: "FEMALE",
        heightMm: 1650,
        weightGrams: 60_000,
        activityLevel: "SEDENTARY",
        completedAt: null,
      },
    });
    expect(await hasCompletedOnboarding(user.id)).toBe(false);
  });

  it("updates in place rather than colliding on a second run", async () => {
    const user = await makeUser();
    const input = (name: string) =>
      fitnessProfileSchema.parse({
        firstName: name,
        age: 24,
        sex: "MALE",
        height: { unit: "cm", cm: 178 },
        weight: { unit: "kg", value: 72 },
        activityLevel: "VERY_ACTIVE",
        lifeContext: "PROFESSIONAL",
        primaryGoal: "STAY_HEALTHY",
      });

    await saveProfile(user.id, input("First"));
    await saveProfile(user.id, input("Second"));

    expect(await db.fitnessProfile.count({ where: { userId: user.id } })).toBe(1);
    expect((await db.fitnessProfile.findUniqueOrThrow({ where: { userId: user.id } })).firstName).toBe(
      "Second",
    );
  });
});

describe("a credential that outlived its account", () => {
  /**
   * Both credential formats are self-contained JWTs, so a correctly-signed one
   * survives the deletion of the user it names — which is what happens when the
   * demo account is re-seeded, or a database is restored from a snapshot.
   *
   * The symptom was a foreign-key error surfacing as "Something went wrong" at
   * the end of onboarding. `accountExists` is what turns that into a 401.
   */
  it("is not treated as a signed-in user", async () => {
    const user = await makeUser();
    expect(await accountExists(user.id)).toBe(true);

    await db.user.delete({ where: { id: user.id } });

    expect(await accountExists(user.id)).toBe(false);
  });

  it("otherwise reaches the database and violates a foreign key", async () => {
    const user = await makeUser();
    const id = user.id;
    await db.user.delete({ where: { id } });

    // The failure the check prevents: a phantom id going straight into a write.
    await expect(
      saveProfile(id, fitnessProfileSchema.parse({
        firstName: "Ghost",
        age: 30,
        sex: "MALE",
        height: { unit: "cm", cm: 178 },
        weight: { unit: "kg", value: 72 },
        activityLevel: "SEDENTARY",
        lifeContext: "OTHER",
        primaryGoal: "STAY_HEALTHY",
      })),
    ).rejects.toThrow();
  });
});

describe("saving a workout", () => {
  it("prices the entry from the catalogue, not from the request", async () => {
    const user = await makeUser();
    const { id } = await runningId();

    const saved = await saveWorkout(user.id, {
      activityId: id,
      duration: 90,
      // A client cannot smuggle a rate or a total: the schema does not carry
      // them and the repository reads both from the catalogue.
    } as never);

    expect(saved.caloriesPerHour).toBe(600);
    expect(saved.caloriesBurned).toBe(900);
  });

  it("copies the activity name so history survives a catalogue change", async () => {
    const user = await makeUser();
    const { id } = await runningId();
    const saved = await saveWorkout(user.id, { activityId: id, duration: 30 });

    await db.activity.update({ where: { id }, data: { name: "Renamed", caloriesPerHour: 1 } });

    const [entry] = await listHistory(user.id);
    expect(entry.activityName).toBe("Running");
    expect(entry.caloriesPerHour).toBe(600);
    expect(entry.caloriesBurned).toBe(saved.caloriesBurned);
  });

  it("rejects an unknown activity", async () => {
    const user = await makeUser();
    await expectStatus(previewBurn({ activityId: "no-such-activity", duration: 30 }), 404);
    await expectStatus(saveWorkout(user.id, { activityId: "no-such-activity", duration: 30 }), 404);
  });
});

describe("cross-user isolation", () => {
  it("does not list another user's workouts", async () => {
    const { alice, bob } = await makeTwoUsers();
    await makeWorkout(alice.id);

    expect(await listHistory(alice.id)).toHaveLength(1);
    expect(await listHistory(bob.id)).toHaveLength(0);
  });

  it("cannot delete another user's workout", async () => {
    const { alice, bob } = await makeTwoUsers();
    const entry = await makeWorkout(alice.id);

    await expectStatus(deleteWorkout(bob.id, entry.id), 404);
    // Reported as missing, and genuinely still there.
    expect(await db.workoutEntry.count({ where: { id: entry.id } })).toBe(1);

    await deleteWorkout(alice.id, entry.id);
    expect(await db.workoutEntry.count({ where: { id: entry.id } })).toBe(0);
  });

  it("does not count another user's workouts in the statistics", async () => {
    const { alice, bob } = await makeTwoUsers();
    await makeWorkout(alice.id, { minutes: 60 });

    const stats = await getFitnessStats(bob.id);
    expect(stats.today.calories).toBe(0);
    expect(stats.weekTotal).toBe(0);
  });

  it("removes a user's workouts and profile when the account goes", async () => {
    const user = await makeUser();
    await makeFitnessProfile(user.id);
    await makeWorkout(user.id);

    await db.user.delete({ where: { id: user.id } });

    expect(await db.workoutEntry.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.fitnessProfile.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("statistics", () => {
  /** Alice's timezone in the factories is Europe/London. */
  async function userInZone(timezone: string) {
    const user = await makeUser();
    await db.userSettings.update({ where: { userId: user.id }, data: { timezone } });
    return user;
  }

  it("counts a late-evening workout against that evening, not the next UTC day", async () => {
    // 23:30 in Asia/Kolkata is 18:00 UTC the same day. In a zone far the other
    // way the same instant is already tomorrow — which is exactly the bug that
    // bucketing by UTC would introduce.
    const user = await userInZone("Asia/Kolkata");
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    // 23:30 local today, expressed as an instant (IST is UTC+5:30).
    const lateTonight = new Date(`${local}T23:30:00+05:30`);

    // Only meaningful while that instant has actually arrived; otherwise the
    // workout is in the future and belongs to no completed day yet.
    if (lateTonight <= now) {
      await makeWorkout(user.id, { minutes: 60, performedAt: lateTonight });
      const stats = await getFitnessStats(user.id);
      expect(stats.today.calories).toBe(600);
      expect(stats.week.find((d) => d.isToday)?.calories).toBe(600);
    }
  });

  it("totals today separately from the week", async () => {
    const user = await userInZone("UTC");
    const now = new Date();
    await makeWorkout(user.id, { minutes: 60, performedAt: now });
    await makeWorkout(user.id, { slug: "yoga", minutes: 30, performedAt: now });

    const stats = await getFitnessStats(user.id);
    expect(stats.today.calories).toBe(600 + 100);
    expect(stats.today.workouts).toBe(2);
    expect(stats.today.minutes).toBe(90);
    expect(stats.weekTotal).toBeGreaterThanOrEqual(700);
  });

  it("always returns seven days, even with nothing logged", async () => {
    const user = await userInZone("UTC");
    const stats = await getFitnessStats(user.id);

    expect(stats.week).toHaveLength(7);
    expect(stats.week.filter((d) => d.isToday)).toHaveLength(1);
    expect(new Set(stats.week.map((d) => d.date)).size).toBe(7);
    expect(stats.weekBest).toBe(0);
    expect(stats.streakDays).toBe(0);
  });

  it("keeps a streak alive on a day nothing has been logged yet", async () => {
    const user = await userInZone("UTC");
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Yesterday and the day before, but nothing today.
    await makeWorkout(user.id, { performedAt: new Date(now - day) });
    await makeWorkout(user.id, { performedAt: new Date(now - 2 * day) });

    const stats = await getFitnessStats(user.id);
    expect(stats.today.calories).toBe(0);
    expect(stats.streakDays).toBe(2);
  });
});
