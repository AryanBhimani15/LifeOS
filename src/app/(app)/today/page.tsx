import { requireUserId } from "@/lib/session";
import { getHomeData } from "@/lib/repositories/home";
import { hourInZone } from "@/lib/dates";
import { greetingForHour } from "@/lib/fitness";
import { HomeUpcomingAgenda } from "@/components/home/HomeUpcomingAgenda";
import { HomeNotesWorkspace } from "@/components/home/HomeNotesWorkspace";
import { TodayTodoList } from "@/components/home/TodayTodoList";
import { HomeGoals } from "@/components/home/HomeGoals";
import { HomeImportantUpcoming } from "@/components/home/HomeImportantUpcoming";

export const metadata = { title: "LifeOS — Home" };

export default async function TodayPage() {
  const userId = await requireUserId();
  const data = await getHomeData(userId);
  const greeting = greetingForHour(hourInZone(data.zone));

  return (
    <div className="home-reference">
      <header className="home-hero">
        <div className="home-hero-copy">
          <p>{greeting},</p>
          <h1>{data.profile?.firstName ?? "there"} <span>✧</span></h1>
          <small>Focus on today, progress every day.</small>
        </div>
      </header>
      <section className="home-left">
        <TodayTodoList
          key={data.todayTasks.map((task) => `${task.id}:${task.status}:${task.updatedAt.toISOString()}`).join("|")}
          initialTasks={data.todayTasks.map((task) => ({
            id: task.id,
            title: task.title,
            done: task.status === "DONE",
            priority: task.priority,
            project: task.project?.name ?? null,
            dueAt: task.dueAt?.toISOString() ?? null,
            dueHasTime: task.dueHasTime,
          }))}
          timeZone={data.zone}
        />

        <HomeImportantUpcoming upcoming={data.upcoming ? { ...data.upcoming, at: data.upcoming.at.toISOString() } : null} timeZone={data.zone} />

        <HomeUpcomingAgenda items={data.week} today={data.today} />

        <HomeGoals
          today={data.today}
          goals={data.goals.map((goal) => ({ ...goal, targetDate: goal.targetDate?.toISOString() ?? null }))}
        />
      </section>

      <HomeNotesWorkspace
        notes={data.notes.map((note) => ({ ...note, updatedAt: note.updatedAt.toISOString() }))}
        today={data.habits.today}
        habits={data.habits.habits.map((habit) => ({
          id: habit.id,
          name: habit.name,
          icon: habit.icon,
          doneToday: habit.doneToday,
          streak: habit.streak,
        }))}
      />
    </div>
  );
}
