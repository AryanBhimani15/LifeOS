"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, Link2, Plus, X } from "lucide-react";
import { linkHabitAction, linkTaskAction } from "@/app/(app)/goals/actions";

/**
 * The work attached to a goal.
 *
 * Nothing here creates a task or a habit. Both lists point at records that
 * already exist and already have their own home, so unlinking removes the
 * association and leaves the work untouched — and a task ticked off on the
 * board is ticked off here, because it is the same row.
 */

export interface LinkedTask {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
}

export interface LinkedHabit {
  id: string;
  name: string;
  cadence: string;
}

export interface Candidate {
  id: string;
  label: string;
}

const CADENCE: Record<string, string> = {
  DAILY: "Daily",
  SPECIFIC_DAYS: "Chosen days",
  TIMES_PER_WEEK: "Weekly target",
};

export function GoalLinks({
  goalId,
  tasks,
  habits,
  taskOptions,
  habitOptions,
  countsTowardProgress,
}: {
  goalId: string;
  tasks: LinkedTask[];
  habits: LinkedHabit[];
  taskOptions: Candidate[];
  habitOptions: Candidate[];
  countsTowardProgress: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picker, setPicker] = useState<"task" | "habit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      else {
        setError(null);
        setPicker(null);
        router.refresh();
      }
    });

  const linkedTaskIds = new Set(tasks.map((task) => task.id));
  const linkedHabitIds = new Set(habits.map((habit) => habit.id));
  const availableTasks = taskOptions.filter((option) => !linkedTaskIds.has(option.id));
  const availableHabits = habitOptions.filter((option) => !linkedHabitIds.has(option.id));

  return (
    <section className="goal-panel">
      <header>
        <h2>Linked work</h2>
        {countsTowardProgress && <span>Drives this goal&rsquo;s progress</span>}
      </header>

      <div className="goal-link-group">
        <h3>
          Tasks
          {availableTasks.length > 0 && (
            <button type="button" onClick={() => setPicker(picker === "task" ? null : "task")}>
              <Plus size={13} /> Link a task
            </button>
          )}
        </h3>

        {tasks.length === 0 ? (
          <p className="goal-panel-empty">
            No tasks linked yet. Link ones you already have rather than writing them twice.
          </p>
        ) : (
          <ul className="goal-linked-list">
            {tasks.map((task) => (
              <li key={task.id} className={task.status === "DONE" ? "is-done" : ""}>
                <span className="goal-linked-state">
                  {task.status === "DONE" ? <Check size={13} /> : <Circle size={11} />}
                </span>
                <Link href={`/tasks?task=${task.id}`}>{task.title}</Link>
                <button
                  type="button"
                  onClick={() => run(() => linkTaskAction(goalId, task.id, false))}
                  disabled={pending}
                  aria-label={`Unlink ${task.title}`}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {picker === "task" && (
          <div className="goal-picker" role="listbox" aria-label="Tasks you can link">
            {availableTasks.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => run(() => linkTaskAction(goalId, option.id, true))}
                disabled={pending}
              >
                <Link2 size={12} /> {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="goal-link-group">
        <h3>
          Habits
          {availableHabits.length > 0 && (
            <button type="button" onClick={() => setPicker(picker === "habit" ? null : "habit")}>
              <Plus size={13} /> Link a habit
            </button>
          )}
        </h3>

        {habits.length === 0 ? (
          <p className="goal-panel-empty">
            A habit is how a goal gets done on an ordinary Tuesday. Link one when you have it.
          </p>
        ) : (
          <ul className="goal-linked-list">
            {habits.map((habit) => (
              <li key={habit.id}>
                <span className="goal-linked-state"><Circle size={11} /></span>
                <Link href="/habits">{habit.name}</Link>
                <em>{CADENCE[habit.cadence] ?? habit.cadence}</em>
                <button
                  type="button"
                  onClick={() => run(() => linkHabitAction(goalId, habit.id, false))}
                  disabled={pending}
                  aria-label={`Unlink ${habit.name}`}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {picker === "habit" && (
          <div className="goal-picker" role="listbox" aria-label="Habits you can link">
            {availableHabits.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => run(() => linkHabitAction(goalId, option.id, true))}
                disabled={pending}
              >
                <Link2 size={12} /> {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="goal-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
