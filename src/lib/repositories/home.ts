import { db } from "@/lib/db";
import { DEFAULT_KINDS, type CalendarItem } from "@/lib/calendar";
import { calendarItems, calendarSettings } from "@/lib/repositories/calendar";
import { getProfile } from "@/lib/repositories/fitness";
import { headlineGoals } from "@/lib/repositories/goals";
import { todayHabits } from "@/lib/repositories/habits";
import { addCalendarDays, endOfDayInZone, startOfCalendarDayInZone } from "@/lib/dates";

/**
 * The bounded Home read.  Home deliberately does not use the broad dashboard
 * summary: this is the small, human-sized slice needed to answer what matters
 * today.  Every query is scoped by `userId`; none is a per-card or per-row
 * request.
 */

export type HomeUpcomingCandidate = {
  id: string;
  title: string;
  source: "task" | "event";
  kind: "TASK" | "EXAM" | "EVENT" | "DEADLINE";
  at: Date;
  allDay: boolean;
  dueHasTime?: boolean;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  href: string;
};

export type HomeUpcomingItem = HomeUpcomingCandidate & {
  label: "Next exam" | "Overdue work" | "High-priority deadline" | "Upcoming deadline" | "Upcoming event";
  overdue: boolean;
};

const PRIORITY_SCORE = { LOW: 0, MEDIUM: 2, HIGH: 8, URGENT: 12 } as const;

/**
 * Picks the one thing that deserves a place below Today's list.  Categories
 * outrank chronological proximity: a real exam should never be hidden by a
 * low-stakes event happening a few minutes earlier.  The final timestamp/id
 * comparisons make ties stable and testable.
 */
export function rankHomeUpcoming(
  candidates: HomeUpcomingCandidate[],
  now = new Date(),
): HomeUpcomingItem | null {
  const scored = candidates.map((candidate) => {
    const overdue = candidate.source === "task" && candidate.at.getTime() < now.getTime();
    const hoursAway = Math.max(0, (candidate.at.getTime() - now.getTime()) / 3_600_000);
    const nearTerm = hoursAway <= 7 * 24;

    let score = 100;
    let label: HomeUpcomingItem["label"] = "Upcoming event";

    if (candidate.kind === "EXAM") {
      score = 600;
      label = "Next exam";
    } else if (overdue) {
      score = 520 + (candidate.priority ? PRIORITY_SCORE[candidate.priority] : 0);
      label = "Overdue work";
    } else if (candidate.kind === "TASK" && candidate.priority && candidate.priority !== "LOW" && nearTerm) {
      score = 420 + PRIORITY_SCORE[candidate.priority];
      label = "High-priority deadline";
    } else if (candidate.kind === "DEADLINE") {
      score = 380;
      label = "Upcoming deadline";
    } else if (candidate.kind === "TASK") {
      score = 260 + (candidate.priority ? PRIORITY_SCORE[candidate.priority] : 0);
      label = "Upcoming deadline";
    }

    // Closer items win *within* the same meaningful category, rather than
    // turning the card into a blind nearest-timestamp picker.
    return { candidate, score, label, overdue };
  });

  scored.sort((a, b) =>
    b.score - a.score ||
    a.candidate.at.getTime() - b.candidate.at.getTime() ||
    a.candidate.id.localeCompare(b.candidate.id),
  );

  const winner = scored[0];
  return winner ? { ...winner.candidate, label: winner.label, overdue: winner.overdue } : null;
}

export async function getHomeData(userId: string) {
  const { zone, today } = await calendarSettings(userId);
  const dayStart = startOfCalendarDayInZone(today, zone);
  const dayEnd = endOfDayInZone(dayStart, zone);
  const weekEnd = addCalendarDays(today, 6);
  const upcomingEnd = endOfDayInZone(startOfCalendarDayInZone(addCalendarDays(today, 30), zone), zone);

  const [profile, todayTasks, candidateTasks, candidateEvents, notes, goals, habits, week] = await Promise.all([
    getProfile(userId),
    db.task.findMany({
      where: { userId, isTemplate: false, status: { not: "CANCELLED" }, dueAt: { gte: dayStart, lte: dayEnd } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        dueHasTime: true,
        updatedAt: true,
        project: { select: { name: true } },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 30,
    }),
    db.task.findMany({
      where: {
        userId,
        isTemplate: false,
        parentId: null,
        status: { notIn: ["DONE", "CANCELLED"] },
        dueAt: { not: null, lte: upcomingEnd },
      },
      select: { id: true, title: true, dueAt: true, dueHasTime: true, priority: true },
      orderBy: { dueAt: "asc" },
      take: 80,
    }),
    db.event.findMany({
      // An all-day exam starts at midnight, so filtering by `startAt >= now`
      // would make it disappear halfway through its own day. `endAt` tells us
      // whether it is still relevant while `startAt` bounds the look-ahead.
      where: { userId, isTemplate: false, startAt: { gte: dayStart, lte: upcomingEnd }, endAt: { gte: new Date() } },
      select: { id: true, title: true, kind: true, startAt: true, allDay: true },
      orderBy: { startAt: "asc" },
      take: 50,
    }),
    db.note.findMany({
      where: { userId },
      select: { id: true, title: true, content: true, pinned: true, updatedAt: true },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
    headlineGoals(userId, 2),
    todayHabits(userId, 5),
    calendarItems(userId, { from: today, to: weekEnd, kinds: DEFAULT_KINDS }),
  ]);

  const now = new Date();
  const candidate = rankHomeUpcoming([
    ...candidateTasks.flatMap((task): HomeUpcomingCandidate[] => task.dueAt ? [{
      id: task.id,
      title: task.title,
      source: "task",
      kind: "TASK",
      at: task.dueAt,
      allDay: !task.dueHasTime,
      dueHasTime: task.dueHasTime,
      priority: task.priority,
      href: `/tasks?focus=${task.id}`,
    }] : []),
    ...candidateEvents.map((event): HomeUpcomingCandidate => ({
      id: event.id,
      title: event.title,
      source: "event",
      kind: event.kind === "EXAM" ? "EXAM" : event.kind === "DEADLINE" ? "DEADLINE" : "EVENT",
      at: event.startAt,
      allDay: event.allDay,
      href: `/events/${event.id}`,
    })),
  ], now);

  return {
    zone,
    today,
    profile,
    todayTasks,
    upcoming: candidate,
    week: dedupeCalendarItems(week),
    notes,
    goals,
    habits,
  };
}

/** Calendar sources have distinct keys. Keep this defensive at the Home edge. */
function dedupeCalendarItems(items: CalendarItem[]) {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}
