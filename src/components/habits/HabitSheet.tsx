"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { createHabitAction, updateHabitAction } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/ToastProvider";
import {
  HABIT_CATEGORIES,
  WEEKDAY_LETTERS,
  WEEKDAY_NAMES,
  reminderInputValue,
} from "@/lib/habits";
import { HabitIcon, HABIT_ICON_KEYS } from "./HabitIcon";

/**
 * Creating and editing a habit — one form, because the fields are identical and
 * two would drift.
 *
 * The frequency picker offers "Weekly" even though the schema has no such
 * cadence: it is stored as one time per week. The user gets the word they think
 * in; the database keeps one way of saying it.
 */

export interface GoalOption {
  id: string;
  title: string;
}

export interface HabitDraft {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  cadence: string;
  byWeekday: number[];
  targetPerWeek: number;
  reminderMinutes: number | null;
  goal: { id: string; title: string } | null;
}

type Frequency = "DAILY" | "SPECIFIC_DAYS" | "TIMES_PER_WEEK" | "WEEKLY";

const FREQUENCIES: { value: Frequency; label: string; hint: string }[] = [
  { value: "DAILY", label: "Daily", hint: "Every single day." },
  { value: "SPECIFIC_DAYS", label: "Certain days", hint: "Pick the weekdays." },
  { value: "TIMES_PER_WEEK", label: "X times a week", hint: "Any days you like." },
  { value: "WEEKLY", label: "Weekly", hint: "Once in each week." },
];

function frequencyOf(habit: HabitDraft | null): Frequency {
  if (!habit) return "DAILY";
  if (habit.cadence === "TIMES_PER_WEEK" && habit.targetPerWeek === 1) return "WEEKLY";
  return habit.cadence as Frequency;
}

export function HabitSheet({
  goals,
  habit = null,
  trigger = "button",
}: {
  goals: GoalOption[];
  /** Present when editing; absent when creating. */
  habit?: HabitDraft | null;
  trigger?: "button" | "edit";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: habit?.name ?? "",
    description: habit?.description ?? "",
    category: habit?.category ?? "HEALTH",
    icon: habit?.icon ?? "sparkles",
    reminder: reminderInputValue(habit?.reminderMinutes),
    startedOn: "",
    goalId: habit?.goal?.id ?? "",
  });
  const [frequency, setFrequency] = useState<Frequency>(frequencyOf(habit));
  const [weekdays, setWeekdays] = useState<number[]>(habit?.byWeekday ?? [1, 3, 5]);
  const [timesPerWeek, setTimesPerWeek] = useState(
    habit && habit.cadence === "TIMES_PER_WEEK" ? Math.max(2, habit.targetPerWeek) : 3,
  );

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const name = form.name.trim();
    if (!name) {
      setError("A habit needs a name.");
      return;
    }
    if (frequency === "SPECIFIC_DAYS" && weekdays.length === 0) {
      setError("Pick at least one day of the week.");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || null,
      category: form.category,
      icon: form.icon,
      cadence: frequency === "WEEKLY" ? "TIMES_PER_WEEK" : frequency,
      byWeekday: frequency === "SPECIFIC_DAYS" ? [...weekdays].sort((a, b) => a - b) : [],
      targetPerWeek:
        frequency === "WEEKLY" ? 1 : frequency === "TIMES_PER_WEEK" ? timesPerWeek : 7,
      reminder: form.reminder || null,
      goalId: form.goalId || null,
      ...(habit ? {} : { startedOn: form.startedOn || null }),
    };

    startTransition(async () => {
      const result = habit
        ? await updateHabitAction(habit.id, payload)
        : await createHabitAction(payload);

      if (result.error) {
        setError(result.error);
        return;
      }

      toast(habit ? "Habit updated." : `"${name}" added.`);
      close();
      if (!habit && "id" in result && result.id) router.push(`/habits/${result.id}`);
      else router.refresh();
    });
  }

  return (
    <>
      {trigger === "edit" ? (
        <button type="button" className="habit-secondary-button" onClick={() => setOpen(true)}>
          <Pencil size={14} /> Edit
        </button>
      ) : (
        <button type="button" className="habit-new-button" onClick={() => setOpen(true)}>
          <Plus size={15} /> Add habit
        </button>
      )}

      {open && (
        <div className="goal-sheet-backdrop" onMouseDown={close}>
          <aside
            className="goal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={habit ? "Edit habit" : "New habit"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>{habit ? "Edit habit" : "New habit"}</h2>
                <p>Small enough to do on your worst day.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close">
                <X size={17} />
              </button>
            </header>

            <form onSubmit={submit}>
              <label className="goal-field">
                <span>Habit</span>
                <input
                  ref={firstField}
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Morning meditation"
                  maxLength={120}
                  required
                />
              </label>

              <label className="goal-field">
                <span>Description <em>optional</em></span>
                <textarea
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="Ten minutes before anything else."
                  rows={2}
                  maxLength={2000}
                />
              </label>

              <div className="goal-field">
                <span>Icon</span>
                <div className="goal-icon-picker">
                  {HABIT_ICON_KEYS.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={form.icon === key ? "is-selected" : ""}
                      onClick={() => set("icon", key)}
                      aria-label={key.replace("-", " ")}
                      aria-pressed={form.icon === key}
                    >
                      <HabitIcon name={key} size={16} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="goal-field-row">
                <label className="goal-field">
                  <span>Category</span>
                  <select
                    value={form.category}
                    onChange={(event) => set("category", event.target.value)}
                  >
                    {HABIT_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="goal-field">
                  <span>Goal it serves <em>optional</em></span>
                  <select
                    value={form.goalId}
                    onChange={(event) => set("goalId", event.target.value)}
                  >
                    <option value="">No goal</option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="goal-field">
                <span>How often?</span>
                <div className="goal-mode-picker">
                  {FREQUENCIES.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={frequency === option.value ? "is-selected" : ""}
                      onClick={() => setFrequency(option.value)}
                      aria-pressed={frequency === option.value}
                    >
                      <b>{option.label}</b>
                      <em>{option.hint}</em>
                    </button>
                  ))}
                </div>
              </div>

              {frequency === "SPECIFIC_DAYS" && (
                <div className="goal-field">
                  <span>Which days?</span>
                  <div className="habit-weekdays" role="group" aria-label="Days of the week">
                    {WEEKDAY_LETTERS.map((letter, index) => {
                      const on = weekdays.includes(index);
                      return (
                        <button
                          type="button"
                          key={WEEKDAY_NAMES[index]}
                          className={on ? "is-selected" : ""}
                          aria-pressed={on}
                          aria-label={WEEKDAY_NAMES[index]}
                          onClick={() =>
                            setWeekdays((prev) =>
                              prev.includes(index)
                                ? prev.filter((day) => day !== index)
                                : [...prev, index],
                            )
                          }
                        >
                          {letter}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {frequency === "TIMES_PER_WEEK" && (
                <label className="goal-field">
                  <span>Times a week</span>
                  <div className="habit-times">
                    {[2, 3, 4, 5, 6].map((count) => (
                      <button
                        type="button"
                        key={count}
                        className={timesPerWeek === count ? "is-selected" : ""}
                        aria-pressed={timesPerWeek === count}
                        onClick={() => setTimesPerWeek(count)}
                      >
                        {count}×
                      </button>
                    ))}
                  </div>
                </label>
              )}

              <div className="goal-field-row">
                <label className="goal-field">
                  <span>Reminder <em>optional</em></span>
                  <input
                    type="time"
                    value={form.reminder}
                    onChange={(event) => set("reminder", event.target.value)}
                  />
                </label>
                {!habit && (
                  <label className="goal-field">
                    <span>Start date <em>optional</em></span>
                    <input
                      type="date"
                      value={form.startedOn}
                      onChange={(event) => set("startedOn", event.target.value)}
                    />
                  </label>
                )}
              </div>

              {error && (
                <p className="goal-form-error" role="alert">
                  {error}
                </p>
              )}

              <footer>
                <button type="button" onClick={close} className="goal-secondary-button">
                  Cancel
                </button>
                <button type="submit" className="goal-primary-button" disabled={pending}>
                  {pending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                  {pending ? "Saving…" : habit ? "Save changes" : "Add habit"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
