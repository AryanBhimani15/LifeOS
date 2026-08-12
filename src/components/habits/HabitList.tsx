"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronRight, Flame, Target } from "lucide-react";
import { setHabitDayAction } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/ToastProvider";
import { reminderLabel, streakLabel, type Streak } from "@/lib/habits";
import { HabitIcon } from "./HabitIcon";

/**
 * Today's habits, each with the one control that matters: the circle.
 *
 * The tick flips immediately and reverts if the server refuses. Undo is the
 * same control pressed again, and it sends the state it wants rather than a
 * toggle — so a double tap ends up where the user can see it did.
 */

export interface HabitRow {
  id: string;
  name: string;
  icon: string | null;
  category: string;
  cadenceText: string;
  reminderMinutes: number | null;
  doneToday: boolean;
  dueToday: boolean;
  streak: Streak;
  weekDone: number;
  targetPerWeek: number;
  cadence: string;
  goal: { id: string; title: string } | null;
}

export function HabitList({ habits, today }: { habits: HabitRow[]; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const isDone = (habit: HabitRow) => optimistic[habit.id] ?? habit.doneToday;

  function toggle(habit: HabitRow) {
    const next = !isDone(habit);
    setOptimistic((prev) => ({ ...prev, [habit.id]: next }));

    startTransition(async () => {
      const result = await setHabitDayAction(habit.id, next, today);
      if (result.error) {
        setOptimistic((prev) => ({ ...prev, [habit.id]: !next }));
        toast(result.error, "error");
        return;
      }
      router.refresh();
    });
  }

  if (habits.length === 0) {
    return (
      <p className="habit-empty-inline">
        Nothing is scheduled for today. That is allowed.
      </p>
    );
  }

  return (
    <ul className="habit-list">
      {habits.map((habit) => {
        const done = isDone(habit);
        const reminder = reminderLabel(habit.reminderMinutes);
        return (
          <li key={habit.id} className={done ? "is-done" : ""}>
            <button
              type="button"
              className="habit-tick"
              onClick={() => toggle(habit)}
              disabled={pending}
              aria-pressed={done}
              aria-label={done ? `Mark ${habit.name} not done today` : `Mark ${habit.name} done today`}
            >
              {done ? <Check size={15} /> : null}
            </button>

            <span className="habit-row-icon">
              <HabitIcon name={habit.icon} />
            </span>

            <Link href={`/habits/${habit.id}`} className="habit-row-body">
              <b>{habit.name}</b>
              <span className="habit-row-meta">
                <em className={habit.streak.count > 0 ? "is-hot" : ""}>
                  <Flame size={11} /> {streakLabel(habit.streak)}
                </em>
                <em>{habit.cadenceText}</em>
                {reminder && (
                  <em>
                    <Bell size={11} /> {reminder}
                  </em>
                )}
                {habit.cadence === "TIMES_PER_WEEK" && (
                  <em>
                    {habit.weekDone} of {habit.targetPerWeek} this week
                  </em>
                )}
                {habit.goal && (
                  <em className="habit-row-goal">
                    <Target size={11} /> {habit.goal.title}
                  </em>
                )}
              </span>
            </Link>

            <ChevronRight size={16} className="habit-row-arrow" />
          </li>
        );
      })}
    </ul>
  );
}
