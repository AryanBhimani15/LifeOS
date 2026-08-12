import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { getTodayData } from "@/lib/repositories/dashboard";
import { getProfile } from "@/lib/repositories/fitness";
import { listUpcomingEvents } from "@/lib/repositories/events";
import { endOfDayInZone, hourInZone, startOfDayInZone } from "@/lib/dates";
import { greetingForHour } from "@/lib/fitness";
import { HomeUpcomingAgenda } from "@/components/home/HomeUpcomingAgenda";
import { HomeNotesWorkspace } from "@/components/home/HomeNotesWorkspace";
import { TodayTodoList } from "@/components/home/TodayTodoList";

export const metadata = { title: "LifeOS — Home" };

export default async function TodayPage() {
  const userId = await requireUserId();
  const [data, profile, upcoming, notes] = await Promise.all([
    getTodayData(userId),
    getProfile(userId),
    listUpcomingEvents(userId, 12),
    db.note.findMany({
      where: { userId },
      select: { id: true, title: true, content: true, pinned: true, updatedAt: true },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
  ]);
  const todayTasks = await db.task.findMany({
    where: {
      userId,
      isTemplate: false,
      dueAt: { gte: startOfDayInZone(new Date(), data.zone), lte: endOfDayInZone(new Date(), data.zone) },
    },
    select: { id: true, title: true, status: true },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 20,
  });
  const greeting = greetingForHour(hourInZone(data.zone));

  return (
    <div className="home-reference">
      <header className="home-hero">
        <div className="home-hero-copy">
          <p>{greeting},</p>
          <h1>{profile?.firstName ?? "there"} <span>✧</span></h1>
          <small>Focus on today, progress every day.</small>
        </div>
      </header>
      <section className="home-left">
        <TodayTodoList initialTasks={todayTasks.map((task) => ({ ...task, done: task.status === "DONE" }))} />

        <HomeUpcomingAgenda events={upcoming.map((event) => ({ ...event, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString() }))} />
      </section>

      <HomeNotesWorkspace
        notes={notes.map((note) => ({ ...note, updatedAt: note.updatedAt.toISOString() }))}
        focus={data.now}
      />
    </div>
  );
}
