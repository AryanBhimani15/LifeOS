"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { createGoalAction } from "@/app/(app)/goals/actions";
import { useToast } from "@/components/ToastProvider";
import { GOAL_CATEGORIES, PROGRESS_MODES } from "@/lib/goals";
import { GoalIcon, GOAL_ICON_KEYS } from "./GoalIcon";

/**
 * Creating a goal.
 *
 * The form asks for the mode first and then only the fields that mode needs: a
 * percentage goal is never asked for a unit, and a numeric one cannot be saved
 * without a target. That is the same rule the server enforces, so the form is a
 * convenience rather than the control.
 */

export interface LinkOption {
  id: string;
  label: string;
  hint?: string;
}

export function NewGoalSheet({
  projects,
  tasks,
  habits,
}: {
  projects: LinkOption[];
  tasks: LinkOption[];
  habits: LinkOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    icon: "target",
    progressMode: "MANUAL",
    targetValue: "",
    currentValue: "",
    unit: "",
    startDate: "",
    targetDate: "",
    projectId: "",
  });
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [habitIds, setHabitIds] = useState<string[]>([]);
  const [showLinks, setShowLinks] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);

  // Escape closes the sheet, which is what every user tries first.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const numeric = form.progressMode === "NUMERIC";

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const title = form.title.trim();
    if (!title) {
      setError("A goal needs a name.");
      return;
    }

    const amount = (value: string) => (value.trim() === "" ? null : Number(value));
    if (numeric && !(Number(form.targetValue) > 0)) {
      setError("A goal measured by a number needs a target above zero.");
      return;
    }

    startTransition(async () => {
      const result = await createGoalAction({
        title,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        icon: form.icon,
        progressMode: form.progressMode,
        targetValue: numeric ? amount(form.targetValue) : null,
        currentValue: numeric ? (amount(form.currentValue) ?? 0) : null,
        unit: numeric ? form.unit.trim() || null : null,
        startDate: form.startDate || null,
        targetDate: form.targetDate || null,
        projectId: form.projectId || null,
        taskIds,
        habitIds,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      toast(`"${title}" is now a goal.`);
      close();
      if (result.id) router.push(`/goals/${result.id}`);
      else router.refresh();
    });
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

  return (
    <>
      <button type="button" className="goal-new-button" onClick={() => setOpen(true)}>
        <Plus size={15} /> New goal
      </button>

      {open && (
        <div className="goal-sheet-backdrop" onMouseDown={close}>
          <aside
            className="goal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="New goal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>New goal</h2>
                <p>Something worth a few months of your attention.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close">
                <X size={17} />
              </button>
            </header>

            <form onSubmit={submit}>
              <label className="goal-field">
                <span>Goal</span>
                <input
                  ref={firstField}
                  value={form.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder="Complete BT final year project"
                  maxLength={160}
                  required
                />
              </label>

              <label className="goal-field">
                <span>Description <em>optional</em></span>
                <textarea
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="What does finishing this actually look like?"
                  rows={2}
                  maxLength={4000}
                />
              </label>

              <div className="goal-field">
                <span>Icon</span>
                <div className="goal-icon-picker">
                  {GOAL_ICON_KEYS.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={form.icon === key ? "is-selected" : ""}
                      onClick={() => set("icon", key)}
                      aria-label={key.replace("-", " ")}
                      aria-pressed={form.icon === key}
                    >
                      <GoalIcon name={key} size={17} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="goal-field-row">
                <label className="goal-field">
                  <span>Category</span>
                  <input
                    value={form.category}
                    onChange={(event) => set("category", event.target.value)}
                    list="goal-categories"
                    placeholder="Study"
                    maxLength={40}
                  />
                  <datalist id="goal-categories">
                    {GOAL_CATEGORIES.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </label>
                <label className="goal-field">
                  <span>Project <em>optional</em></span>
                  <select
                    value={form.projectId}
                    onChange={(event) => set("projectId", event.target.value)}
                  >
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="goal-field">
                <span>How is progress measured?</span>
                <div className="goal-mode-picker">
                  {PROGRESS_MODES.map((mode) => (
                    <button
                      type="button"
                      key={mode.value}
                      className={form.progressMode === mode.value ? "is-selected" : ""}
                      onClick={() => set("progressMode", mode.value)}
                      aria-pressed={form.progressMode === mode.value}
                    >
                      <b>{mode.label}</b>
                      <em>{mode.hint}</em>
                    </button>
                  ))}
                </div>
              </div>

              {numeric && (
                <div className="goal-field-row goal-field-row-three">
                  <label className="goal-field">
                    <span>Target</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.targetValue}
                      onChange={(event) => set("targetValue", event.target.value)}
                      placeholder="100000"
                      required
                    />
                  </label>
                  <label className="goal-field">
                    <span>Starting at</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.currentValue}
                      onChange={(event) => set("currentValue", event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label className="goal-field">
                    <span>Unit</span>
                    <input
                      value={form.unit}
                      onChange={(event) => set("unit", event.target.value)}
                      placeholder="₹ or books"
                      maxLength={12}
                    />
                  </label>
                </div>
              )}

              <div className="goal-field-row">
                <label className="goal-field">
                  <span>Start date <em>optional</em></span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => set("startDate", event.target.value)}
                  />
                </label>
                <label className="goal-field">
                  <span>Deadline <em>optional</em></span>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(event) => set("targetDate", event.target.value)}
                  />
                </label>
              </div>

              {(tasks.length > 0 || habits.length > 0) && (
                <div className="goal-links-disclosure">
                  <button type="button" onClick={() => setShowLinks((value) => !value)}>
                    {showLinks ? "Hide" : "Link existing work"}
                    {taskIds.length + habitIds.length > 0 &&
                      ` · ${taskIds.length + habitIds.length} selected`}
                  </button>

                  {showLinks && (
                    <div className="goal-link-lists">
                      {tasks.length > 0 && (
                        <div>
                          <h3>Tasks</h3>
                          <div className="goal-link-scroll">
                            {tasks.map((task) => (
                              <label key={task.id}>
                                <input
                                  type="checkbox"
                                  checked={taskIds.includes(task.id)}
                                  onChange={() => setTaskIds((prev) => toggle(prev, task.id))}
                                />
                                <span>{task.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {habits.length > 0 && (
                        <div>
                          <h3>Habits</h3>
                          <div className="goal-link-scroll">
                            {habits.map((habit) => (
                              <label key={habit.id}>
                                <input
                                  type="checkbox"
                                  checked={habitIds.includes(habit.id)}
                                  onChange={() => setHabitIds((prev) => toggle(prev, habit.id))}
                                />
                                <span>{habit.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                  {pending ? "Creating…" : "Create goal"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
