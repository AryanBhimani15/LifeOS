import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, Folder } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayInZone } from "@/lib/dates";
import { deadlineLabel } from "@/lib/goals";
import { getGoal, linkableHabits, linkableTasks } from "@/lib/repositories/goals";
import { GoalIcon } from "@/components/goals/GoalIcon";
import { GoalProgressBar, GoalTrend } from "@/components/goals/GoalProgress";
import { GoalActions, ProgressControl } from "@/components/goals/GoalControls";
import { MilestoneList } from "@/components/goals/MilestoneList";
import { GoalLinks } from "@/components/goals/GoalLinks";

export const metadata = { title: "LifeOS — Goal" };

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ACHIEVED: "Achieved",
  PAUSED: "Paused",
  ABANDONED: "Dropped",
};

/**
 * One goal, and everything hanging off it.
 *
 * Dates cross to the client as ISO strings because a Date does not survive the
 * server-to-client boundary intact; each component formats in the user's zone
 * at the point of display.
 */
export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  let goal;
  try {
    goal = await getGoal(userId, id);
  } catch (error) {
    // A goal that is not yours is genuinely not found, which is what the
    // repository already decided. The page just honours it.
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [settings, taskOptions, habitOptions] = await Promise.all([
    db.userSettings.findUnique({ where: { userId }, select: { timezone: true } }),
    linkableTasks(userId, goal.id),
    linkableHabits(userId, goal.id),
  ]);

  const today = todayInZone(settings?.timezone ?? "UTC");
  const due = deadlineLabel(goal.targetDate, today);
  const overdue = due?.includes("overdue") && goal.status === "ACTIVE";

  return (
    <>
      <header className="topbar goal-detail-topbar">
        <div>
          <Link href="/goals" className="goal-back">
            <ChevronLeft size={14} /> Goals
          </Link>
          <div className="goal-detail-title">
            <span className="goal-card-icon"><GoalIcon name={goal.icon} size={20} /></span>
            <div>
              <h1>{goal.title}</h1>
              <p className="goal-detail-meta">
                <span className={`goal-status is-${goal.status.toLowerCase()}`}>
                  {STATUS_LABEL[goal.status]}
                </span>
                {goal.category && <em>{goal.category}</em>}
                {goal.project && (
                  <em className="goal-card-project">
                    <Folder size={11} /> {goal.project.name}
                  </em>
                )}
                {due && (
                  <span className={overdue ? "is-overdue" : ""}>
                    <CalendarDays size={11} /> {due}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        <GoalActions goalId={goal.id} title={goal.title} status={goal.status} />
      </header>

      {goal.description && <p className="goal-description">{goal.description}</p>}

      <div className="goal-detail-grid">
        <div className="goal-detail-main">
          <section className="goal-panel goal-panel-progress">
            <header>
              <h2>Progress</h2>
            </header>
            <GoalProgressBar percent={goal.percent} detail={goal.detail} />
            <ProgressControl
              goalId={goal.id}
              mode={goal.progressMode}
              percent={goal.percent}
              currentValue={goal.currentValue}
              targetValue={goal.targetValue}
              unit={goal.unit}
            />
          </section>

          <MilestoneList
            goalId={goal.id}
            milestones={goal.milestones.map((milestone) => ({
              id: milestone.id,
              title: milestone.title,
              targetDate: milestone.targetDate?.toISOString() ?? null,
              completedAt: milestone.completedAt?.toISOString() ?? null,
            }))}
            counts={{ done: goal.milestonesDone, total: goal.milestonesTotal }}
          />

          <GoalLinks
            goalId={goal.id}
            countsTowardProgress={goal.progressMode === "TASKS"}
            tasks={goal.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              dueAt: task.dueAt?.toISOString() ?? null,
            }))}
            habits={goal.habits.map((habit) => ({
              id: habit.id,
              name: habit.name,
              cadence: habit.cadence,
            }))}
            taskOptions={taskOptions.map((task) => ({ id: task.id, label: task.title }))}
            habitOptions={habitOptions.map((habit) => ({ id: habit.id, label: habit.name }))}
          />
        </div>

        <aside className="goal-detail-side">
          <section className="goal-panel">
            <header>
              <h2>Trend</h2>
            </header>
            <GoalTrend
              points={goal.progress.map((point) => ({
                percent: point.percent,
                recordedAt: point.recordedAt.toISOString(),
              }))}
            />
          </section>

          <section className="goal-panel">
            <header>
              <h2>Details</h2>
            </header>
            <dl className="goal-facts">
              <div>
                <dt>Measured by</dt>
                <dd>
                  {goal.progressMode === "MANUAL" && "A percentage you set"}
                  {goal.progressMode === "NUMERIC" && "A number to reach"}
                  {goal.progressMode === "MILESTONES" && "Completed milestones"}
                  {goal.progressMode === "TASKS" && "Linked tasks"}
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDay(goal.startDate ?? goal.createdAt)}</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>{goal.targetDate ? formatDay(goal.targetDate) : "None set"}</dd>
              </div>
              {goal.achievedAt && (
                <div>
                  <dt>Achieved</dt>
                  <dd>{formatDay(goal.achievedAt)}</dd>
                </div>
              )}
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
