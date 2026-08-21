import { db } from "@/lib/db";
import { addDays, monthGridRange, scheduleLoad, type CalendarItem } from "@/lib/calendar";
import { addCalendarDays, endOfDayInZone, startOfCalendarDayInZone } from "@/lib/dates";
import { parseCapture } from "@/lib/nlp/parse-capture";
import { calendarItems, calendarSettings } from "@/lib/repositories/calendar";
import { captureTask, listTasks } from "@/lib/repositories/tasks";
import type { MobileQuickCaptureInput, MobileTaskListQuery } from "@/lib/validation/mobile";

/**
 * The deliberately small native-client read model.
 *
 * It is a projection over the same task, event and calendar repositories used
 * by the web app. It does not introduce a mobile-owned table or a second idea
 * of what is due today.
 */
export async function mobileToday(userId: string) {
  const { zone, today, weekStartsOn } = await calendarSettings(userId);
  const dayStart = startOfCalendarDayInZone(today, zone);
  const dayEnd = endOfDayInZone(dayStart, zone);
  const laterFrom = addCalendarDays(today, 1);
  const laterTo = addCalendarDays(today, 7);

  const [user, tasks, todayItems, laterItems] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    }),
    db.task.findMany({
      where: {
        userId,
        isTemplate: false,
        parentId: null,
        status: { notIn: ["CANCELLED"] },
        dueAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        dueHasTime: true,
        description: true,
      },
      orderBy: [{ dueAt: "asc" }, { boardOrder: "asc" }],
      take: 50,
    }),
    calendarItems(userId, { from: today, to: today, kinds: ["task", "exam", "event"] }),
    calendarItems(userId, { from: laterFrom, to: laterTo, kinds: ["task", "exam", "event"] }),
  ]);

  const upcoming = [...todayItems, ...laterItems]
    .filter((item) => item.kind === "exam" || item.kind === "event")
    .filter((item) => !item.done)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.minutes ?? -1) - (b.minutes ?? -1))[0] ?? null;

  return {
    user,
    timezone: zone,
    weekStartsOn,
    today,
    scheduleLoad: scheduleLoad(todayItems),
    tasks,
    upNext: upcoming,
    later: laterItems.filter((item) => item.key !== upcoming?.key).slice(0, 8),
  };
}

/** A bounded month grid and agenda, using the canonical Calendar projection. */
export async function mobileCalendar(userId: string, anchor: string) {
  const { zone, today, weekStartsOn } = await calendarSettings(userId);
  const month = `${anchor.slice(0, 7)}-01`;
  const range = monthGridRange(month, weekStartsOn);
  const items = await calendarItems(userId, {
    ...range,
    kinds: ["task", "exam", "event", "fitness"],
  });

  return {
    timezone: zone,
    today,
    weekStartsOn,
    month,
    range,
    items,
  };
}

/**
 * Native list filters only translate presentation choices into the existing
 * task repository's query contract. Task ownership, ordering and pagination
 * remain exactly the same as the desktop Tasks page.
 */
export async function mobileTaskList(userId: string, query: MobileTaskListQuery) {
  const { zone, today } = await calendarSettings(userId);
  const dayStart = startOfCalendarDayInZone(today, zone);
  const dayEnd = endOfDayInZone(dayStart, zone);
  const openStatuses: Array<"TODO" | "IN_PROGRESS" | "BLOCKED"> = ["TODO", "IN_PROGRESS", "BLOCKED"];

  return listTasks(userId, {
    status: query.filter === "completed" ? ["DONE"] : openStatuses,
    search: query.search || undefined,
    ...(query.filter === "today"
      ? { dueAfter: dayStart.toISOString(), dueBefore: dayEnd.toISOString() }
      : query.filter === "upcoming"
        ? { dueAfter: dayEnd.toISOString() }
        : {}),
    includeSubtasks: false,
    sort: "dueAt",
    dir: "asc",
    limit: 100,
  });
}

/** The server's deterministic parser, exposed only as a preview for native capture. */
export async function previewMobileTaskCapture(userId: string, text: string) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });
  const parsed = parseCapture(text, {
    timeZone: settings?.timezone ?? "UTC",
    weekStartsOn: settings?.weekStartsOn ?? 1,
  });
  return {
    title: parsed.title,
    dueAt: parsed.dueAt?.toISOString() ?? null,
    dueHasTime: parsed.dueHasTime,
    matchedText: parsed.matchedText,
  };
}

/**
 * Native quick add stays on the canonical capture path. A selected date is an
 * explicit override; otherwise the exact same deterministic parser is used.
 */
export async function createMobileTaskCapture(userId: string, input: MobileQuickCaptureInput) {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, weekStartsOn: true },
  });

  const { task, matchedText } = await captureTask(
    userId,
    {
      text: input.text,
      ...(input.dueAt !== undefined
        ? { dueAt: input.dueAt ? new Date(input.dueAt) : null, dueHasTime: input.dueHasTime }
        : {}),
      note: input.note,
      remindAt: input.remindAt ? new Date(input.remindAt) : null,
      priority: input.priority,
    },
    { timeZone: settings?.timezone ?? "UTC", weekStartsOn: settings?.weekStartsOn ?? 1 },
  );

  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      dueHasTime: task.dueHasTime,
      description: task.description,
    },
    matchedText,
  };
}

/** Kept exported for the mobile API's serializer tests. */
export function mobileAgendaItems(items: CalendarItem[], from: string, days = 8) {
  const to = addDays(from, days - 1);
  return items.filter((item) => item.day >= from && item.day <= to);
}
