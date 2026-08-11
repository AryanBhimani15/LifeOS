"use client";

import { useState, useTransition } from "react";
import { toggleHabitAction } from "@/app/(app)/actions";
import { useToast } from "./ToastProvider";

interface Habit {
  id: string;
  name: string;
  doneToday: boolean;
  streak: number;
}

/**
 * Habit checkboxes with optimistic toggling.
 *
 * The tick flips immediately and reverts if the server rejects it, so the UI
 * never claims a completion that was not recorded.
 */
export function HabitGrid({ habits }: { habits: Habit[] }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const isDone = (habit: Habit) => optimistic[habit.id] ?? habit.doneToday;

  function toggle(habit: Habit) {
    const next = !isDone(habit);
    setOptimistic((prev) => ({ ...prev, [habit.id]: next }));

    startTransition(async () => {
      try {
        await toggleHabitAction(habit.id);
      } catch {
        setOptimistic((prev) => ({ ...prev, [habit.id]: !next }));
        toast(`Could not update ${habit.name}.`, "error");
      }
    });
  }

  return (
    <div className="habit-grid" aria-busy={pending}>
      {habits.map((habit) => {
        const done = isDone(habit);
        return (
          <button
            className={`habit ${done ? "done" : ""}`}
            key={habit.id}
            onClick={() => toggle(habit)}
            aria-pressed={done}
          >
            <span className="habit-check">{done && "✓"}</span>
            <b>{habit.name}</b>
            <small>↗ {habit.streak}d</small>
          </button>
        );
      })}
    </div>
  );
}
