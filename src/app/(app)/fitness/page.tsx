import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Clock, Flame, Repeat } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { endOfDayInZone, hourInZone, startOfDayInZone, todayInZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatDuration, greetingForHour } from "@/lib/fitness";
import {
  getFitnessStats,
  getProfile,
  listActivities,
  listHistory,
} from "@/lib/repositories/fitness";
import { getActivePlan } from "@/lib/repositories/onboarding";
import { ActivityIcon } from "@/components/fitness/ActivityIcon";
import { HistoryList } from "@/components/fitness/HistoryList";
import { PlanToday } from "@/components/fitness/PlanToday";
import { QuickLog } from "@/components/fitness/QuickLog";
import { WeeklyChart } from "@/components/fitness/WeeklyChart";

export const metadata = { title: "LifeOS — Fitness" };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Position in the user's week, so the list starts on their Monday (or Sunday). */
function weekPosition(dayOfWeek: number, weekStartsOn: number): number {
  return (dayOfWeek - weekStartsOn + 7) % 7;
}

/**
 * Fitness.
 *
 * Ordered by what someone opens this page to do, which is very rarely "read
 * analytics": today's session first, then the two fields that record one, then
 * the week, then what they have already done. The calculator used to sit below
 * the plan, the weekly chart and a profile card — far enough down that logging
 * a workout meant scrolling past everything that was not the point.
 *
 * Progress stays, compactly, on the side. It is context, not the task.
 */
export default async function FitnessPage() {
  const userId = await requireUserId();

  const [profile, activities, stats, recent] = await Promise.all([
    getProfile(userId),
    listActivities(),
    getFitnessStats(userId),
    listHistory(userId, 5),
  ]);

  if (!profile?.completedAt) redirect("/onboarding");

  const now = new Date();
  const [plan, settings] = await Promise.all([
    getActivePlan(userId, stats.zone, startOfDayInZone(now, stats.zone), endOfDayInZone(now, stats.zone)),
    db.userSettings.findUnique({ where: { userId }, select: { weekStartsOn: true } }),
  ]);
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const todayIndex = new Date(`${todayInZone(stats.zone)}T00:00:00Z`).getUTCDay();

  const greeting = greetingForHour(hourInZone(stats.zone));

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">FITNESS</p>
          <h1 className="greeting">
            {greeting}
            <em>{profile.firstName}.</em>
          </h1>
        </div>
        <div className="header-actions">
          <Link className="icon-button fit-history-link" href="/fitness/history">
            History
          </Link>
        </div>
      </header>

      <div className="fit-layout">
        <div className="main-column">
          {/* ---- 1. What am I doing today ---- */}
          <section className="section reveal delay-1">
            <div className="section-title">
              <span>Today</span>
              {plan && (
                <span className="section-meta">
                  {plan.name} · {plan.daysPerWeek} days a week
                </span>
              )}
            </div>
            <PlanToday
              sessions={plan?.today ?? []}
              restMessage="Rest day — nothing planned. Log anything you did below."
            />
          </section>

          {/* ---- 2. Log it, without scrolling ---- */}
          <section className="section reveal delay-2">
            <div className="section-title">
              <span>Log a workout</span>
              <span className="section-meta">Anything, planned or not</span>
            </div>
            <div className="fit-card">
              <QuickLog activities={activities} />
            </div>
          </section>

          {/* ---- 3. What I've done ---- */}
          <section className="section reveal delay-3">
            <div className="section-title">
              <span>Recent</span>
              <Link className="section-meta fit-link" href="/fitness/history">
                View all
              </Link>
            </div>
            <div className="fit-card fit-history-card">
              <HistoryList
                entries={recent}
                zone={stats.zone}
                emptyMessage="Nothing logged yet."
              />
            </div>
          </section>
        </div>

        {/* ---- 4. Progress and the week, secondary ---- */}
        <aside className="fit-aside">
          <article className="fit-card fit-today reveal delay-1">
            <span className="fit-card-title">Today&apos;s burn</span>
            <b className="fit-big">{stats.today.calories.toLocaleString()}</b>
            <span className="fit-big-unit">kcal</span>

            <dl className="fit-meta">
              <div>
                <dt>
                  <Flame size={13} /> Activities
                </dt>
                <dd>{stats.today.workouts}</dd>
              </div>
              <div>
                <dt>
                  <Clock size={13} /> Time
                </dt>
                <dd>{stats.today.minutes > 0 ? formatDuration(stats.today.minutes) : "—"}</dd>
              </div>
              <div>
                <dt>
                  <Repeat size={13} /> Streak
                </dt>
                <dd>
                  {stats.streakDays > 0
                    ? `${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </article>

          <article className="fit-card fit-week reveal delay-2">
            <div className="fit-card-head">
              <span className="fit-card-title">This week</span>
              <span className="fit-card-note">{stats.weekTotal.toLocaleString()} kcal</span>
            </div>
            <WeeklyChart week={stats.week} best={stats.weekBest} />
          </article>

          {plan && (
            <article className="fit-card reveal delay-3">
              <div className="fit-card-head">
                <span className="fit-card-title">Your plan</span>
                <Link className="fit-card-note fit-link" href="/onboarding?edit=1">
                  Change
                </Link>
              </div>
              <ol className="plan-week-list">
                {[...plan.sessions]
                  .sort(
                    (a, b) =>
                      weekPosition(a.dayOfWeek, weekStartsOn) - weekPosition(b.dayOfWeek, weekStartsOn),
                  )
                  .map((session) => (
                    <li key={session.id} className={session.dayOfWeek === todayIndex ? "is-today" : ""}>
                      <span className="plan-week-day">{DAY_NAMES[session.dayOfWeek]}</span>
                      <span className="plan-week-icon">
                        <ActivityIcon icon={session.activityIcon} size={14} />
                      </span>
                      <span className="plan-week-name">{session.activityName}</span>
                      <span className="plan-week-time">{formatDuration(session.durationMinutes)}</span>
                    </li>
                  ))}
              </ol>
            </article>
          )}

          <Link className="fit-profile-link" href="/onboarding?edit=1">
            Your details <ArrowUpRight size={13} />
          </Link>
        </aside>
      </div>
    </>
  );
}
