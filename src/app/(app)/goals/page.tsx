import Link from "next/link";
import { CheckCircle2, ChevronRight, Sparkles, Target, TrendingUp } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { todayInZone } from "@/lib/dates";
import { deadlineLabel } from "@/lib/goals";
import { goalStats, listGoals } from "@/lib/repositories/goals";
import { listGoalsSchema } from "@/lib/validation/goal";
import { GoalIcon } from "@/components/goals/GoalIcon";
import { GoalProgressBar } from "@/components/goals/GoalProgress";
import { NewGoalSheet } from "@/components/goals/NewGoalSheet";

export const metadata = { title: "LifeOS — Goals" };

/**
 * The goals index.
 *
 * Tab and sort live in the URL rather than in component state, so a filtered
 * view can be linked, bookmarked and — the part that matters after a goal is
 * edited — survives a refresh.
 */

const TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
] as const;

const SORTS = [
  { value: "deadline", label: "Due date" },
  { value: "progress", label: "Progress" },
  { value: "created", label: "Recently created" },
  { value: "name", label: "Name" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ACHIEVED: "Achieved",
  PAUSED: "Paused",
  ABANDONED: "Dropped",
};

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;

  // Unparseable query strings fall back to the defaults rather than erroring:
  // a hand-edited URL should show the goals, not a stack trace.
  const query = listGoalsSchema.safeParse(params).data ?? { tab: "all" as const, sort: "deadline" as const };

  const [goals, stats, settings, projects, tasks, habits] = await Promise.all([
    listGoals(userId, query),
    goalStats(userId),
    db.userSettings.findUnique({ where: { userId }, select: { timezone: true } }),
    db.project.findMany({ where: { userId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 50 }),
    db.task.findMany({
      where: { userId, isTemplate: false, parentId: null, goalId: null, status: { not: "DONE" } },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.habit.findMany({ where: { userId, archivedAt: null, goalId: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 40 }),
  ]);

  const today = todayInZone(settings?.timezone ?? "UTC");
  const href = (patch: Partial<typeof query>) => {
    const next = new URLSearchParams({ ...query, ...patch });
    return `/goals?${next.toString()}`;
  };

  return (
    <>
      <header className="topbar goals-topbar">
        <div>
          <p className="eyebrow">DIRECTION</p>
          <h1>Goals</h1>
          <p className="goals-subtitle">Track what matters and turn big plans into progress.</p>
        </div>
        <NewGoalSheet
          projects={projects.map((project) => ({ id: project.id, label: project.name }))}
          tasks={tasks.map((task) => ({ id: task.id, label: task.title }))}
          habits={habits.map((habit) => ({ id: habit.id, label: habit.name }))}
        />
      </header>

      <section className="goal-stats" aria-label="Summary">
        <div className="goal-stat">
          <span className="goal-stat-icon"><Target size={17} /></span>
          <div>
            <b>{stats.active}</b>
            <small>Active goals</small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><CheckCircle2 size={17} /></span>
          <div>
            <b>{stats.completed}</b>
            <small>Completed</small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><TrendingUp size={17} /></span>
          <div>
            <b>
              {stats.monthProgress > 0 ? "+" : ""}
              {stats.monthProgress}%
            </b>
            <small>
              This month
              {stats.monthGoalCount > 0 && `, across ${stats.monthGoalCount} goal${stats.monthGoalCount === 1 ? "" : "s"}`}
            </small>
          </div>
        </div>
      </section>

      <section className="goal-toolbar">
        <nav aria-label="Filter goals">
          {TABS.map((tab) => (
            <Link
              key={tab.value}
              href={href({ tab: tab.value })}
              className={query.tab === tab.value ? "is-active" : ""}
              aria-current={query.tab === tab.value ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="goal-sorts">
          <span>Sort</span>
          {SORTS.map((sort) => (
            <Link
              key={sort.value}
              href={href({ sort: sort.value })}
              className={query.sort === sort.value ? "is-active" : ""}
            >
              {sort.label}
            </Link>
          ))}
        </div>
      </section>

      {goals.length === 0 ? (
        <div className="goal-empty">
          <span><Sparkles size={20} /></span>
          <h2>{query.tab === "completed" ? "Nothing finished yet" : "No goals here yet"}</h2>
          <p>
            {query.tab === "completed"
              ? "Goals you achieve will collect here."
              : "A goal is the thing your tasks and habits are for. Add one and link the work you are already doing."}
          </p>
        </div>
      ) : (
        <ul className="goal-list">
          {goals.map((goal) => {
            const due = deadlineLabel(goal.targetDate, today);
            const overdue = due?.includes("overdue") && goal.status === "ACTIVE";
            return (
              <li key={goal.id}>
                <Link href={`/goals/${goal.id}`} className="goal-card">
                  <span className="goal-card-icon"><GoalIcon name={goal.icon} /></span>
                  <div className="goal-card-body">
                    <div className="goal-card-head">
                      <h2>{goal.title}</h2>
                      <span className={`goal-status is-${goal.status.toLowerCase()}`}>
                        {STATUS_LABEL[goal.status]}
                      </span>
                    </div>
                    <p className="goal-card-meta">
                      {goal.category && <em>{goal.category}</em>}
                      {goal.project && <em className="goal-card-project">{goal.project.name}</em>}
                      {due && <span className={overdue ? "is-overdue" : ""}>{due}</span>}
                    </p>
                    <GoalProgressBar percent={goal.percent} detail={goal.detail} />
                  </div>
                  <ChevronRight size={17} className="goal-card-arrow" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
