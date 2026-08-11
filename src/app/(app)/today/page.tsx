import Link from "next/link";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { getTodayData } from "@/lib/repositories/dashboard";
import { formatMoney } from "@/lib/money";
import { HabitGrid } from "@/components/HabitGrid";
import { Sparkline } from "@/components/Sparkline";

export const metadata = { title: "LifeOS — Today" };

export default async function TodayPage() {
  const userId = await requireUserId();
  const data = await getTodayData(userId);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: data.zone,
  })
    .format(new Date())
    .toUpperCase();

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1>
            Today <kbd>⌘ K</kbd>
          </h1>
        </div>
        <div className="header-actions">
          <Link className="new-button" href="/tasks">
            <Plus size={16} /> New task
          </Link>
        </div>
      </header>

      <div className="content-grid">
        <div className="main-column">
          {/* ---- Now ---- */}
          <section className="section reveal delay-1">
            <div className="section-title">
              <span>Now</span>
              <span className="section-meta">
                {data.counts.overdue > 0 && `${data.counts.overdue} overdue · `}
                {data.counts.open} open
              </span>
            </div>

            {data.now.length === 0 ? (
              <EmptyState
                message="Nothing is demanding your attention."
                action={{ href: "/tasks", label: "Add a task" }}
              />
            ) : (
              <div className="task-list">
                {data.now.map((task) => (
                  <Link className="task-row" key={task.id} href={`/tasks?focus=${task.id}`}>
                    <span className={`task-dot ${task.tone}`} />
                    <span className="task-copy">
                      <b>{task.title}</b>
                      <small>{task.why}</small>
                    </span>
                    <span className={`task-due ${task.overdue ? "overdue" : ""}`}>{task.due}</span>
                    <ArrowUpRight className="task-arrow" size={15} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* ---- Timeline ---- */}
          <section className="section reveal delay-2">
            <div className="section-title">
              <span>Today&apos;s timeline</span>
              <span className="section-meta">8 AM — 8 PM</span>
            </div>

            {data.events.length === 0 ? (
              <EmptyState message="No events scheduled today." />
            ) : (
              <>
                <div className="time-labels">
                  <span>8 AM</span>
                  <span>10 AM</span>
                  <span>12 PM</span>
                  <span>2 PM</span>
                  <span>4 PM</span>
                  <span>6 PM</span>
                  <span>8 PM</span>
                </div>
                <div className="timeline">
                  {data.events.map((event) => (
                    <div className="time-block blue" key={event.id}>
                      <span>{event.title}</span>
                      <small>
                        {new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: data.zone,
                        }).format(event.startAt)}
                        {" · "}
                        {durationLabel(event.startAt, event.endAt)}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ---- Habits ---- */}
          <section className="section habits-section reveal delay-3">
            <div className="section-title">
              <span>
                Habits{" "}
                {data.habits.length > 0 && (
                  <em>
                    {data.habits.filter((h) => h.doneToday).length}/{data.habits.length} today
                  </em>
                )}
              </span>
            </div>
            {data.habits.length === 0 ? (
              <EmptyState message="No habits yet. Try “track a daily walk” in ⌘K." />
            ) : (
              <HabitGrid habits={data.habits} />
            )}
          </section>

          {/* ---- Goals ---- */}
          <section className="section goals-section reveal delay-4">
            <div className="section-title">
              <span>Goals</span>
            </div>
            {data.goals.length === 0 ? (
              <EmptyState message="No active goals." />
            ) : (
              data.goals.map((goal) => (
                <div className="goal-row" key={goal.id}>
                  <span>{goal.title}</span>
                  <div className="goal-track">
                    <i style={{ width: `${goal.percent}%` }} />
                  </div>
                  <b>{goal.percent}%</b>
                </div>
              ))
            )}
          </section>

          {/* ---- Spending ---- */}
          <section className="spending reveal delay-5">
            <div>
              <span>Spending</span>
              <small>Last 30 days</small>
              <b>{formatMoney(data.spend.totalMinor, data.currency)}</b>
            </div>
            <Sparkline values={data.spend.series} />
          </section>
        </div>

        {/* ---- Daily brief ---- */}
        <aside className="daily-brief reveal delay-2">
          <div className="brief-top">
            <span className="brief-icon">
              <Sparkles size={15} />
            </span>
            <span>DAILY BRIEF</span>
          </div>
          <Brief data={data} />
        </aside>
      </div>
    </>
  );
}

/**
 * The brief is assembled from real counts rather than generated text.
 *
 * An LLM-written brief would cost a request per page load and could state a
 * deadline that does not exist; these sentences can only say what the data says.
 */
function Brief({ data }: { data: Awaited<ReturnType<typeof getTodayData>> }) {
  const { counts, habits, goals } = data;
  const habitsLeft = habits.filter((h) => !h.doneToday);
  const atRiskStreak = habitsLeft.find((h) => h.streak >= 3);

  const headline =
    counts.overdue > 0
      ? "Clear the overdue work first."
      : counts.dueToday > 0
        ? "Make the afternoon count."
        : "A clear runway today.";

  return (
    <>
      <h2>{headline}</h2>

      {counts.overdue > 0 ? (
        <p>
          <strong>
            {counts.overdue} task{counts.overdue === 1 ? " is" : "s are"} overdue
          </strong>{" "}
          — those outrank everything else scheduled today.
        </p>
      ) : counts.dueToday > 0 ? (
        <p>
          You have {counts.dueToday} task{counts.dueToday === 1 ? "" : "s"} due today and{" "}
          {data.events.length} event{data.events.length === 1 ? "" : "s"} scheduled.
        </p>
      ) : (
        <p>Nothing is due today. A good day to pull work forward.</p>
      )}

      <div className="brief-rule" />

      {atRiskStreak ? (
        <p>
          <strong>Your {atRiskStreak.name} streak is at risk</strong> — {atRiskStreak.streak} days
          so far, and today is not ticked off yet.
        </p>
      ) : habits.length > 0 ? (
        <p>
          {habits.filter((h) => h.doneToday).length} of {habits.length} habits done today.
        </p>
      ) : null}

      {goals.length > 0 && (
        <p>
          {goals.length} active goal{goals.length === 1 ? "" : "s"}, averaging{" "}
          {Math.round(goals.reduce((sum, g) => sum + g.percent, 0) / goals.length)}% complete.
        </p>
      )}

      <Link className="brief-link" href="/tasks">
        Open the board <ArrowUpRight size={14} />
      </Link>
    </>
  );
}

function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {action && (
        <Link href={action.href} className="empty-action">
          {action.label} <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}

function durationLabel(start: Date, end: Date) {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}
