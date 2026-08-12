"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteHabitAction, setHabitDayAction } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/ToastProvider";
import type { DayState } from "@/lib/habits";

/**
 * The history calendar on a habit's own page.
 *
 * Laid out as weeks in columns, like a contribution graph, because six months
 * of days has to fit on a screen without scrolling to be readable at a glance.
 * Every cell is clickable up to today — this is where a forgotten day gets
 * fixed, and where the streak rules become visible rather than theoretical.
 */

export function HabitHistory({
  habitId,
  history,
  today,
  name,
}: {
  habitId: string;
  history: { iso: string; state: DayState }[];
  today: string;
  name: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, DayState>>({});

  const stateOf = (day: { iso: string; state: DayState }) => optimistic[day.iso] ?? day.state;

  function toggle(day: { iso: string; state: DayState }) {
    const state = stateOf(day);
    if (day.iso > today) return;
    const wasDone = state === "done";
    setOptimistic((prev) => ({ ...prev, [day.iso]: wasDone ? "missed" : "done" }));

    startTransition(async () => {
      const result = await setHabitDayAction(habitId, !wasDone, day.iso);
      if (result.error) {
        setOptimistic((prev) => ({ ...prev, [day.iso]: state }));
        toast(result.error, "error");
        return;
      }
      router.refresh();
    });
  }

  // Pad the front so every column is a full week and the rows line up.
  const first = history[0];
  const lead = first ? new Date(`${first.iso}T00:00:00Z`).getUTCDay() : 0;
  const padded: ({ iso: string; state: DayState } | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...history,
  ];

  const weeks: (typeof padded)[] = [];
  for (let index = 0; index < padded.length; index += 7) {
    weeks.push(padded.slice(index, index + 7));
  }

  const done = history.filter((day) => day.state === "done").length;

  return (
    <section className="goal-panel">
      <header>
        <h2>History</h2>
        <span>
          {done} {done === 1 ? "day" : "days"} in the last {history.length}
        </span>
      </header>

      <div className="habit-history">
        <div className="habit-history-days" aria-hidden="true">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div className="habit-history-grid">
          {weeks.map((week, index) => (
            <div key={index} className="habit-history-week">
              {week.map((day, dayIndex) =>
                day === null ? (
                  <i key={`pad-${dayIndex}`} className="habit-cell is-pad" />
                ) : (
                  <button
                    key={day.iso}
                    type="button"
                    className={`habit-cell is-${stateOf(day)}`}
                    disabled={day.iso > today || pending}
                    onClick={() => toggle(day)}
                    aria-label={`${name}, ${day.iso}: ${stateOf(day)}`}
                    title={`${day.iso} — ${stateOf(day)}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <ul className="habit-legend" aria-label="What the colours mean">
        <li><i className="is-done" /> Done</li>
        <li><i className="is-missed" /> Missed</li>
        <li><i className="is-unscheduled" /> Not scheduled</li>
      </ul>

      <p className="goal-panel-empty habit-history-hint">
        Tap any past day to correct it. Days the habit was not scheduled never count against you.
      </p>
    </section>
  );
}

export function HabitDangerZone({ habitId, name }: { habitId: string; name: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (
      !window.confirm(
        `Delete "${name}"? Its whole completion history goes with it, and that cannot be undone.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteHabitAction(habitId);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      toast("Habit deleted.");
      router.push("/habits");
    });
  }

  return (
    <button
      type="button"
      className="goal-danger-button"
      onClick={remove}
      disabled={pending}
      aria-label={`Delete ${name}`}
    >
      <Trash2 size={14} />
    </button>
  );
}
