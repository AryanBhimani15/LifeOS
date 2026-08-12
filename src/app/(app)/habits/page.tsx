import Link from "next/link";
import { Award, CheckCircle2, Flame, Sparkles } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { habitGrid, habitStats, listHabits } from "@/lib/repositories/habits";
import { listHabitsSchema } from "@/lib/validation/habit";
import { HabitList } from "@/components/habits/HabitList";
import { HabitTracker } from "@/components/habits/HabitTracker";
import { HabitSheet } from "@/components/habits/HabitSheet";

export const metadata = { title: "LifeOS — Habits" };

/**
 * The habits dashboard.
 *
 * Category and view live in the URL for the same reason they do on Goals: the
 * view someone is looking at should survive ticking something off, which
 * refreshes the page.
 */

const CATEGORIES = [
  { value: "ALL", label: "All" },
  { value: "HEALTH", label: "Health" },
  { value: "MIND", label: "Mind" },
  { value: "STUDY", label: "Study" },
  { value: "PERSONAL", label: "Personal" },
] as const;

const VIEWS = [
  { value: "today", label: "Today", days: 7 },
  { value: "weekly", label: "Weekly", days: 14 },
  { value: "monthly", label: "Monthly", days: 30 },
] as const;

export default async function HabitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const query = listHabitsSchema.safeParse(params).data ?? {
    category: "ALL" as const,
    view: "today" as const,
  };

  const days = VIEWS.find((view) => view.value === query.view)?.days ?? 7;

  const [{ habits, today }, stats, grid, goals] = await Promise.all([
    listHabits(userId, query),
    habitStats(userId),
    habitGrid(userId, days),
    db.goal.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const href = (patch: Partial<typeof query>) =>
    `/habits?${new URLSearchParams({ ...query, ...patch }).toString()}`;

  // Today's view leads with what is actually due; the others list everything,
  // because "what did I do on Tuesday" is a different question from "what now".
  const visible = query.view === "today" ? habits.filter((habit) => habit.dueToday) : habits;

  return (
    <>
      <header className="topbar goals-topbar">
        <div>
          <p className="eyebrow">CONSISTENCY</p>
          <h1>Habits</h1>
          <p className="goals-subtitle">Small daily actions, big long-term change.</p>
        </div>
        <HabitSheet goals={goals} />
      </header>

      <section className="goal-stats" aria-label="Summary">
        <div className="goal-stat">
          <span className="goal-stat-icon"><CheckCircle2 size={17} /></span>
          <div>
            <b>
              {stats.doneToday}
              <small className="habit-stat-of">/{stats.dueToday}</small>
            </b>
            <small>Done today</small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><Flame size={17} /></span>
          <div>
            <b>{stats.current?.count ?? 0}</b>
            <small>
              {stats.current
                ? `${stats.current.unit === "week" ? "week" : "day"} streak · ${stats.current.name}`
                : "Current streak"}
            </small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><Award size={17} /></span>
          <div>
            <b>{stats.best?.count ?? 0}</b>
            <small>
              {stats.best
                ? `best ever · ${stats.best.name}`
                : "Best streak"}
            </small>
          </div>
        </div>
      </section>

      <section className="goal-toolbar">
        <nav aria-label="Filter habits">
          {CATEGORIES.map((category) => (
            <Link
              key={category.value}
              href={href({ category: category.value })}
              className={query.category === category.value ? "is-active" : ""}
              aria-current={query.category === category.value ? "page" : undefined}
            >
              {category.label}
            </Link>
          ))}
        </nav>
        <div className="goal-sorts">
          <span>View</span>
          {VIEWS.map((view) => (
            <Link
              key={view.value}
              href={href({ view: view.value })}
              className={query.view === view.value ? "is-active" : ""}
            >
              {view.label}
            </Link>
          ))}
        </div>
      </section>

      {habits.length === 0 ? (
        <div className="goal-empty">
          <span><Sparkles size={20} /></span>
          <h2>{query.category === "ALL" ? "No habits yet" : "Nothing in this category"}</h2>
          <p>
            {query.category === "ALL"
              ? "Start with one you could do on your worst day. The streak is the point, not the size."
              : "Habits you file here will show up on this tab."}
          </p>
        </div>
      ) : (
        <>
          <section className="habit-panel">
            <header>
              <h2>{query.view === "today" ? "Today" : "All habits"}</h2>
              <span>{streakSummary(stats)}</span>
            </header>
            <HabitList
              today={today}
              habits={visible.map((habit) => ({
                id: habit.id,
                name: habit.name,
                icon: habit.icon,
                category: habit.category,
                cadence: habit.cadence,
                cadenceText: habit.cadenceText,
                reminderMinutes: habit.reminderMinutes,
                doneToday: habit.doneToday,
                dueToday: habit.dueToday,
                streak: habit.streak,
                weekDone: habit.weekDone,
                targetPerWeek: habit.targetPerWeek,
                goal: habit.goal,
              }))}
            />
          </section>

          <section className="habit-panel">
            <header>
              <h2>Tracker</h2>
              <span>last {days} days</span>
            </header>
            <HabitTracker rows={grid.rows} dates={grid.dates} today={grid.today} />
          </section>
        </>
      )}
    </>
  );
}

function streakSummary(stats: { doneToday: number; dueToday: number }): string {
  if (stats.dueToday === 0) return "nothing due";
  if (stats.doneToday === stats.dueToday) return "all done";
  return `${stats.dueToday - stats.doneToday} left`;
}
