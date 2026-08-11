import { db } from "@/lib/db";
import type { EntityRef } from "./actions";
import type { DbClient } from "@/lib/authz";

/**
 * Deterministic reference resolution.
 *
 * The model never supplies database ids — it supplies a text descriptor, and
 * this module turns it into an id by querying rows the signed-in user owns.
 * That is what makes a hallucinated or injected reference harmless: the query
 * is always `WHERE userId = <session user>`, so the worst case is "no match",
 * never "someone else's row".
 *
 * When several rows match, resolution deliberately FAILS rather than guessing.
 * Silently picking the first match is how an assistant deletes the wrong thing.
 */

export type Resolution<T> =
  | { status: "resolved"; value: T }
  | { status: "not_found"; query: string }
  | { status: "ambiguous"; query: string; candidates: { id: string; label: string }[] };

export interface ResolvedTask {
  id: string;
  title: string;
}

/** Case-insensitive containment, ranked so better matches win outright. */
function rank(candidateTitle: string, query: string): number {
  const t = candidateTitle.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (t === q) return 3; // exact
  if (t.startsWith(q)) return 2; // prefix
  if (t.includes(q)) return 1; // substring
  return 0;
}

/**
 * Picks a winner only when it is strictly better than every other candidate.
 * Two equally good matches are ambiguous — the user gets asked.
 */
function pickBest<T extends { id: string; title: string }>(
  rows: T[],
  query: string,
): Resolution<T> {
  const scored = rows
    .map((row) => ({ row, score: rank(row.title, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "not_found", query };

  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score);

  if (tied.length > 1) {
    return {
      status: "ambiguous",
      query,
      candidates: tied.slice(0, 8).map((s) => ({ id: s.row.id, label: s.row.title })),
    };
  }

  return { status: "resolved", value: best.row };
}

export async function resolveTask(
  userId: string,
  ref: EntityRef,
): Promise<Resolution<ResolvedTask>> {
  const rows = await db.task.findMany({
    where: {
      userId,
      isTemplate: false,
      // Exclude finished work unless the command is clearly about it; resolving
      // "move my workout" onto a task completed last month is never intended.
      status: { notIn: ["DONE", "CANCELLED"] },
      title: { contains: ref.query, mode: "insensitive" },
      ...(ref.projectHint
        ? { project: { name: { contains: ref.projectHint, mode: "insensitive" } } }
        : {}),
    },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  return pickBest(rows, ref.query);
}

export async function resolveProject(userId: string, ref: EntityRef) {
  const rows = await db.project.findMany({
    where: {
      userId,
      archivedAt: null,
      name: { contains: ref.query, mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  return pickBest(
    rows.map((r) => ({ id: r.id, title: r.name })),
    ref.query,
  );
}

export async function resolveHabit(userId: string, ref: EntityRef) {
  const rows = await db.habit.findMany({
    where: {
      userId,
      archivedAt: null,
      name: { contains: ref.query, mode: "insensitive" },
    },
    select: { id: true, name: true },
    take: 25,
  });

  return pickBest(
    rows.map((r) => ({ id: r.id, title: r.name })),
    ref.query,
  );
}

/**
 * Finds tags by name, creating any that do not exist.
 *
 * Creation is safe here because a tag is just a user-owned label — unlike task
 * or project references, there is nothing to mis-target. Names are matched
 * case-insensitively so "Uni" and "uni" do not become two tags.
 */
export async function resolveOrCreateTags(
  userId: string,
  names: string[],
  client: DbClient = db,
): Promise<string[]> {
  if (names.length === 0) return [];

  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const existing = await client.tag.findMany({
    where: { userId, name: { in: cleaned, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
  const ids: string[] = [];

  for (const name of cleaned) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      ids.push(found);
      continue;
    }
    // Concurrent commands can race on the same name; the unique constraint on
    // (userId, name) makes the loser fall back to a read instead of failing.
    try {
      const created = await client.tag.create({ data: { userId, name } });
      byLower.set(name.toLowerCase(), created.id);
      ids.push(created.id);
    } catch {
      const raced = await client.tag.findFirst({
        where: { userId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (raced) ids.push(raced.id);
    }
  }

  return ids;
}

/** Same idea for expense categories, which are also plain user-owned labels. */
export async function resolveOrCreateCategory(
  userId: string,
  name: string | undefined,
  client: DbClient = db,
): Promise<string | null> {
  if (!name?.trim()) return null;
  const trimmed = name.trim();

  const existing = await client.expenseCategory.findFirst({
    where: { userId, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await client.expenseCategory.create({ data: { userId, name: trimmed } });
    return created.id;
  } catch {
    const raced = await client.expenseCategory.findFirst({
      where: { userId, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true },
    });
    return raced?.id ?? null;
  }
}
