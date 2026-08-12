"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHabitDayAction } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/ToastProvider";
import type { DayState } from "@/lib/habits";
import { HabitIcon } from "./HabitIcon";

/**
 * The tracker grid: habits down, days across.
 *
 * Four cell states, not two. "Not scheduled" has to be visibly different from
 * "missed", or a habit set to three days a week reads as four failures every
 * week — which is both wrong and the fastest way to make someone abandon it.
 *
 * Past cells are clickable so a forgotten day can be filled in. Future cells
 * are not: the server refuses them, and offering a button that always errors
 * is worse than not offering one.
 */

export interface TrackerRow {
  id: string;
  name: string;
  icon: string | null;
  cells: DayState[];
}

const LABEL: Record<DayState, string> = {
  done: "done",
  missed: "missed",
  unscheduled: "not scheduled",
  future: "still to come",
  "before-start": "before this habit started",
};

export function HabitTracker({
  rows,
  dates,
  today,
}: {
  rows: TrackerRow[];
  dates: string[];
  today: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, DayState>>({});

  if (rows.length === 0) return null;

  const key = (habitId: string, iso: string) => `${habitId}:${iso}`;
  const stateOf = (habitId: string, iso: string, fallback: DayState) =>
    optimistic[key(habitId, iso)] ?? fallback;

  function toggle(habitId: string, iso: string, state: DayState) {
    if (iso > today) return;
    const next = state === "done";
    // Reverting to "missed" is a guess the server's next read will correct; it
    // only has to be closer than leaving the cell looking done.
    setOptimistic((prev) => ({ ...prev, [key(habitId, iso)]: next ? "missed" : "done" }));

    startTransition(async () => {
      const result = await setHabitDayAction(habitId, !next, iso);
      if (result.error) {
        setOptimistic((prev) => ({ ...prev, [key(habitId, iso)]: state }));
        toast(result.error, "error");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="habit-tracker">
      <div className="habit-tracker-scroll">
        <table>
          <caption className="sr-only">
            Habit completion for the last {dates.length} days
          </caption>
          <thead>
            <tr>
              <th scope="col">Habit</th>
              {dates.map((iso) => (
                <th key={iso} scope="col" className={iso === today ? "is-today" : ""}>
                  <span aria-hidden="true">{Number(iso.slice(8, 10))}</span>
                  <span className="sr-only">{iso}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className="habit-tracker-icon">
                    <HabitIcon name={row.icon} size={13} />
                  </span>
                  {row.name}
                </th>
                {row.cells.map((raw, index) => {
                  const iso = dates[index];
                  const state = stateOf(row.id, iso, raw);
                  const clickable = iso <= today;
                  return (
                    <td key={iso}>
                      <button
                        type="button"
                        className={`habit-cell is-${state}`}
                        disabled={!clickable || pending}
                        onClick={() => toggle(row.id, iso, state)}
                        aria-label={`${row.name}, ${iso}: ${LABEL[state]}`}
                        title={`${row.name} — ${iso}: ${LABEL[state]}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="habit-legend" aria-label="What the colours mean">
        <li><i className="is-done" /> Done</li>
        <li><i className="is-missed" /> Missed</li>
        <li><i className="is-unscheduled" /> Not scheduled</li>
        <li><i className="is-future" /> To come</li>
      </ul>
    </div>
  );
}
