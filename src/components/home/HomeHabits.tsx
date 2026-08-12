"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Flame } from "lucide-react";
import { setHabitDayAction } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/ToastProvider";
import { HabitIcon } from "@/components/habits/HabitIcon";
import type { Streak } from "@/lib/habits";

/**
 * Today's habits on the Home screen.
 *
 * Only what is actually due today, and tickable from here — the whole point of
 * a habit card on a home screen is that it saves the trip. It is the same
 * action the Habits page calls, so a tick in either place is the same row.
 */

export interface HomeHabit {
  id: string;
  name: string;
  icon: string | null;
  doneToday: boolean;
  streak: Streak;
}

export function HomeHabits({ habits, today }: { habits: HomeHabit[]; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const isDone = (habit: HomeHabit) => optimistic[habit.id] ?? habit.doneToday;
  const done = habits.filter(isDone).length;

  function toggle(habit: HomeHabit) {
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

  return (
    <section className="home-habits">
      <header>
        <span>
          <Flame size={12} /> HABITS
        </span>
        <Link href="/habits">
          All habits <ChevronRight size={14} />
        </Link>
      </header>
      <h2>
        Today&rsquo;s habits
        {habits.length > 0 && (
          <b>
            {done}/{habits.length}
          </b>
        )}
      </h2>

      {habits.length === 0 ? (
        <p className="home-habits-empty">
          Nothing due today. <Link href="/habits">Add a habit</Link> if you want one.
        </p>
      ) : (
        <ul>
          {habits.map((habit) => {
            const ticked = isDone(habit);
            return (
              <li key={habit.id} className={ticked ? "is-done" : ""}>
                <button
                  type="button"
                  onClick={() => toggle(habit)}
                  disabled={pending}
                  aria-pressed={ticked}
                  aria-label={ticked ? `Mark ${habit.name} not done` : `Mark ${habit.name} done`}
                >
                  {ticked ? <Check size={13} /> : null}
                </button>
                <Link href={`/habits/${habit.id}`}>
                  <span className="home-habit-icon">
                    <HabitIcon name={habit.icon} size={14} />
                  </span>
                  <b>{habit.name}</b>
                  {habit.streak.count > 0 && (
                    <em>
                      <Flame size={10} /> {habit.streak.count}
                    </em>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
