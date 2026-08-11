import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

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
