import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { ACTIVITY_CATALOGUE } from "../../prisma/activities";

/**
 * Test fixtures.
 *
 * `resetDatabase` truncates rather than deleting per-model so tests do not have
 * to know the foreign-key ordering, and RESTART IDENTITY keeps sequences stable
 * between runs.
 */

export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    throw new Error("Test database has no tables — run: npm run db:migrate:test");
  }
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  // The activity catalogue is reference data, put there by a migration rather
  // than by any test, so it is restored rather than left empty. Restoring from
  // the checked-in list rather than from a snapshot of the database matters:
  // one test renames an activity on purpose, and a snapshot taken after that
  // would carry the rename into every later run.
  await db.activity.createMany({ data: [...ACTIVITY_CATALOGUE] });
}

let seq = 0;

export async function makeUser(overrides: { email?: string; name?: string } = {}) {
  seq += 1;
  const email = overrides.email ?? `user${seq}-${Date.now()}@example.test`;
  return db.user.create({
    data: {
      email,
      name: overrides.name ?? `User ${seq}`,
      passwordHash: await hashPassword("correct-horse-battery-staple"),
      settings: { create: { timezone: "Europe/London" } },
    },
  });
}

/** Two unrelated users, the standard setup for every isolation test. */
export async function makeTwoUsers() {
  const [alice, bob] = await Promise.all([
    makeUser({ name: "Alice" }),
    makeUser({ name: "Bob" }),
  ]);
  return { alice, bob };
}

export function makeProject(userId: string, name = "Project") {
  return db.project.create({ data: { userId, name } });
}

export function makeTask(userId: string, overrides: Partial<{ title: string; projectId: string }> = {}) {
  return db.task.create({
    data: {
      userId,
      title: overrides.title ?? "A task",
      projectId: overrides.projectId ?? null,
    },
  });
}

export function makeTag(userId: string, name = "urgent") {
  return db.tag.create({ data: { userId, name } });
}

export function makeNote(userId: string, title = "A note") {
  return db.note.create({ data: { userId, title, content: "# hello" } });
}

export function makeGoal(userId: string, title = "A goal") {
  return db.goal.create({ data: { userId, title } });
}

/** A completed onboarding profile, so a user can reach the signed-in app. */
export function makeFitnessProfile(userId: string, firstName = "Alex") {
  return db.fitnessProfile.create({
    data: {
      userId,
      firstName,
      age: 30,
      sex: "MALE",
      heightMm: 1780,
      weightGrams: 75_000,
      activityLevel: "MODERATELY_ACTIVE",
      completedAt: new Date(),
    },
  });
}

/** One saved workout, at an explicit instant so timezone tests can place it. */
export async function makeWorkout(
  userId: string,
  { slug = "running", minutes = 60, performedAt = new Date() } = {},
) {
  const activity = await db.activity.findUniqueOrThrow({ where: { slug } });
  return db.workoutEntry.create({
    data: {
      userId,
      activityId: activity.id,
      activityName: activity.name,
      activityIcon: activity.icon,
      caloriesPerHour: activity.caloriesPerHour,
      durationMinutes: minutes,
      caloriesBurned: Math.round((activity.caloriesPerHour * minutes) / 60),
      performedAt,
    },
  });
}
