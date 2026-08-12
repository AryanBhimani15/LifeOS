import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, ChevronLeft, Flame, Target } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { reminderLabel, streakLabel } from "@/lib/habits";
import { getHabit } from "@/lib/repositories/habits";
import { HabitIcon } from "@/components/habits/HabitIcon";
import { HabitSheet } from "@/components/habits/HabitSheet";
import { HabitHistory, HabitDangerZone } from "@/components/habits/HabitDetail";

export const metadata = { title: "LifeOS — Habit" };

const CATEGORY_LABEL: Record<string, string> = {
  HEALTH: "Health",
  MIND: "Mind",
  STUDY: "Study",
  PERSONAL: "Personal",
  OTHER: "Other",
};

export default async function HabitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  let habit;
  try {
    habit = await getHabit(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const goals = await db.goal.findMany({
    where: { userId, status: "ACTIVE" },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const reminder = reminderLabel(habit.reminderMinutes);

  return (
    <>
      <header className="topbar goal-detail-topbar">
        <div>
          <Link href="/habits" className="goal-back">
            <ChevronLeft size={14} /> Habits
          </Link>
          <div className="goal-detail-title">
            <span className="goal-card-icon"><HabitIcon name={habit.icon} size={20} /></span>
            <div>
              <h1>{habit.name}</h1>
              <p className="goal-detail-meta">
                <span className="goal-status is-active">{CATEGORY_LABEL[habit.category]}</span>
                <em>{habit.cadenceText}</em>
                {reminder && (
                  <em>
                    <Bell size={11} /> {reminder}
                  </em>
                )}
                {habit.goal && (
                  <em className="goal-card-project">
                    <Target size={11} />{" "}
                    <Link href={`/goals/${habit.goal.id}`}>{habit.goal.title}</Link>
                  </em>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="goal-actions">
          <HabitSheet
            goals={goals}
            trigger="edit"
            habit={{
              id: habit.id,
              name: habit.name,
              description: habit.description,
              category: habit.category,
              icon: habit.icon,
              cadence: habit.cadence,
              byWeekday: habit.byWeekday,
              targetPerWeek: habit.targetPerWeek,
              reminderMinutes: habit.reminderMinutes,
              goal: habit.goal,
            }}
          />
          <HabitDangerZone habitId={habit.id} name={habit.name} />
        </div>
      </header>

      {habit.description && <p className="goal-description">{habit.description}</p>}

      <section className="goal-stats" aria-label="This habit in numbers">
        <div className="goal-stat">
          <span className="goal-stat-icon"><Flame size={17} /></span>
          <div>
            <b>{habit.streak.count}</b>
            <small>{streakLabel(habit.streak) === "No streak yet" ? "current streak" : `${habit.streak.unit} streak now`}</small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><Flame size={17} /></span>
          <div>
            <b>{habit.best.count}</b>
            <small>best {habit.best.unit} streak</small>
          </div>
        </div>
        <div className="goal-stat">
          <span className="goal-stat-icon"><Target size={17} /></span>
          <div>
            {/* Null means nothing was due in the window yet — "0%" would be a
                verdict on a habit that has not been asked for anything. */}
            <b>{habit.rate30 === null ? "—" : `${habit.rate30}%`}</b>
            <small>{habit.rate30 === null ? "nothing due yet" : "kept, last 30 days"}</small>
          </div>
        </div>
      </section>

      <div className="goal-detail-grid">
        <div className="goal-detail-main">
          <HabitHistory
            habitId={habit.id}
            history={habit.history}
            today={habit.today}
            name={habit.name}
          />
        </div>

        <aside className="goal-detail-side">
          <section className="goal-panel">
            <header>
              <h2>Details</h2>
            </header>
            <dl className="goal-facts">
              <div>
                <dt>Frequency</dt>
                <dd>{habit.cadenceText}</dd>
              </div>
              <div>
                <dt>Reminder</dt>
                <dd>{reminder ?? "None"}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDay(habit.startedOn ?? habit.createdAt)}</dd>
              </div>
              <div>
                <dt>Times completed</dt>
                <dd>{habit.totalCompletions}</dd>
              </div>
              <div>
                <dt>Kept overall</dt>
                <dd>{habit.rateAll === null ? "Nothing due yet" : `${habit.rateAll}%`}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

function formatDay(date: Date) {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
