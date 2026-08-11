import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { startOfDayInZone, endOfDayInZone, addDays } from "@/lib/dates";

/**
 * Answers for read-only AI questions.
 *
 * These are answered from the database, never by the model. The model's only
 * job is to classify the question into one of the `kind` values; the numbers
 * come from real queries so the assistant cannot hallucinate a deadline.
 */

export type QueryKind =
  | "due_this_week"
  | "overdue"
  | "today"
  | "at_risk"
  | "habit_status"
  | "goal_progress"
  | "spending_summary";

export interface QueryAnswer {
  kind: QueryKind;
  headline: string;
  items: { id: string; label: string; detail?: string }[];
}

async function userZone(userId: string): Promise<string> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return settings?.timezone ?? "UTC";
}

export async function answerQuery(userId: string, kind: QueryKind): Promise<QueryAnswer> {
  const zone = await userZone(userId);
  const now = new Date();

  switch (kind) {
    case "overdue": {
      const tasks = await db.task.findMany({
        where: {
          userId,
          isTemplate: false,
          status: { notIn: ["DONE", "CANCELLED"] },
          dueAt: { lt: now },
        },
        select: { id: true, title: true, dueAt: true, priority: true },
        orderBy: { dueAt: "asc" },
        take: 25,
      });
      return {
        kind,
        headline: tasks.length
          ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} overdue`
          : "Nothing is overdue.",
        items: tasks.map((t) => ({
          id: t.id,
          label: t.title,
          detail: `was due ${t.dueAt!.toISOString().slice(0, 10)} · ${t.priority.toLowerCase()}`,
        })),
      };
    }

    case "today": {
      const from = startOfDayInZone(now, zone);
      const to = endOfDayInZone(now, zone);
      const [tasks, events] = await Promise.all([
        db.task.findMany({
          where: {
            userId,
            isTemplate: false,
            status: { notIn: ["DONE", "CANCELLED"] },
            dueAt: { gte: from, lte: to },
          },
          select: { id: true, title: true, priority: true },
          orderBy: { priority: "desc" },
          take: 25,
        }),
        db.event.findMany({
          where: { userId, startAt: { gte: from, lte: to } },
          select: { id: true, title: true, startAt: true },
          orderBy: { startAt: "asc" },
          take: 25,
        }),
      ]);
      return {
        kind,
        headline: `${tasks.length} task${tasks.length === 1 ? "" : "s"} due today, ${events.length} event${events.length === 1 ? "" : "s"} scheduled`,
        items: [
          ...tasks.map((t) => ({ id: t.id, label: t.title, detail: t.priority.toLowerCase() })),
          ...events.map((e) => ({
            id: e.id,
            label: e.title,
            // Formatted in the USER'S zone. toISOString() renders UTC, which
            // showed a 9am standup as 03:30 for anyone not on UTC.
            detail: new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: zone,
            }).format(e.startAt),
          })),
        ],
      };
    }

    case "due_this_week": {
      const from = startOfDayInZone(now, zone);
      const to = endOfDayInZone(addDays(now, 7), zone);
      const tasks = await db.task.findMany({
        where: {
          userId,
          isTemplate: false,
          status: { notIn: ["DONE", "CANCELLED"] },
          dueAt: { gte: from, lte: to },
        },
        select: { id: true, title: true, dueAt: true, priority: true },
        orderBy: { dueAt: "asc" },
        take: 50,
      });
      return {
        kind,
        headline: `${tasks.length} task${tasks.length === 1 ? "" : "s"} due in the next 7 days`,
        items: tasks.map((t) => ({
          id: t.id,
          label: t.title,
          detail: `${t.dueAt!.toISOString().slice(0, 10)} · ${t.priority.toLowerCase()}`,
        })),
      };
    }

    case "at_risk": {
      // "At risk" is defined here, not by the model: work due within three days
      // that has not started, plus anything already overdue. Ranking by
      // (urgency, priority) keeps the explanation checkable.
      const soon = addDays(now, 3);
      const tasks = await db.task.findMany({
        where: {
          userId,
          isTemplate: false,
          status: { in: ["TODO", "BLOCKED"] },
          dueAt: { lte: soon },
        },
        select: { id: true, title: true, dueAt: true, priority: true, status: true },
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        take: 25,
      });
      return {
        kind,
        headline: tasks.length
          ? `${tasks.length} item${tasks.length === 1 ? "" : "s"} at risk — due within 3 days and not started`
          : "Nothing looks at risk in the next 3 days.",
        items: tasks.map((t) => ({
          id: t.id,
          label: t.title,
          detail:
            (t.dueAt && t.dueAt < now ? "overdue" : `due ${t.dueAt?.toISOString().slice(0, 10)}`) +
            (t.status === "BLOCKED" ? " · blocked" : " · not started"),
        })),
      };
    }

    case "habit_status": {
      const today = startOfDayInZone(now, zone);
      const habits = await db.habit.findMany({
        where: { userId, archivedAt: null },
        select: {
          id: true,
          name: true,
          completions: {
            where: { completedOn: { gte: addDays(today, -30) } },
            select: { completedOn: true },
            orderBy: { completedOn: "desc" },
          },
        },
      });
      return {
        kind,
        headline: `${habits.length} active habit${habits.length === 1 ? "" : "s"}`,
        items: habits.map((h) => ({
          id: h.id,
          label: h.name,
          detail: `${h.completions.length} completion${h.completions.length === 1 ? "" : "s"} in 30 days`,
        })),
      };
    }

    case "goal_progress": {
      const goals = await db.goal.findMany({
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          title: true,
          targetDate: true,
          milestones: { select: { completedAt: true } },
        },
        take: 25,
      });
      return {
        kind,
        headline: `${goals.length} active goal${goals.length === 1 ? "" : "s"}`,
        items: goals.map((g) => {
          const done = g.milestones.filter((m) => m.completedAt).length;
          const total = g.milestones.length;
          return {
            id: g.id,
            label: g.title,
            detail:
              (total ? `${done}/${total} milestones` : "no milestones yet") +
              (g.targetDate ? ` · target ${g.targetDate.toISOString().slice(0, 10)}` : ""),
          };
        }),
      };
    }

    case "spending_summary": {
      const from = startOfDayInZone(addDays(now, -30), zone);
      const rows = await db.expense.groupBy({
        by: ["categoryId"],
        where: { userId, kind: "EXPENSE", spentOn: { gte: from } },
        _sum: { amountMinor: true },
      });
      const categories = await db.expenseCategory.findMany({
        where: { userId },
        select: { id: true, name: true },
      });
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      const settings = await db.userSettings.findUnique({
        where: { userId },
        select: { currency: true },
      });
      const currency = settings?.currency ?? "USD";
      const total = rows.reduce((sum, r) => sum + (r._sum.amountMinor ?? 0), 0);

      return {
        kind,
        headline: `${formatMoney(total, currency)} spent in the last 30 days`,
        items: rows
          .sort((a, b) => (b._sum.amountMinor ?? 0) - (a._sum.amountMinor ?? 0))
          .map((r) => ({
            id: r.categoryId ?? "uncategorised",
            label: r.categoryId ? (nameById.get(r.categoryId) ?? "Unknown") : "Uncategorised",
            detail: formatMoney(r._sum.amountMinor ?? 0, currency),
          })),
      };
    }
  }
}
