"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addMilestoneAction,
  deleteMilestoneAction,
  reorderMilestonesAction,
  updateMilestoneAction,
} from "@/app/(app)/goals/actions";
import { useToast } from "@/components/ToastProvider";

/**
 * Milestones: the steps this goal is actually made of.
 *
 * Reordering is by up/down rather than drag-and-drop. It is operable from a
 * keyboard, it needs no pointer precision, and it sends the whole resulting
 * order to the server, so a dropped request leaves the previous order intact
 * rather than a scrambled one.
 */

export interface Milestone {
  id: string;
  title: string;
  targetDate: string | null;
  completedAt: string | null;
}

export function MilestoneList({
  goalId,
  milestones,
  counts,
}: {
  goalId: string;
  milestones: Milestone[];
  counts: { done: number; total: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * The tick flips immediately and reverts if the server refuses.
   *
   * Waiting for the round trip made the most-used control on the page feel
   * broken for the better part of a second. Same approach as the habit tick: the
   * optimistic value is dropped once the refreshed props arrive, so the server
   * remains the thing that decides.
   */
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const isDone = (milestone: Milestone) =>
    optimistic[milestone.id] ?? milestone.completedAt !== null;

  const run = (work: () => Promise<{ error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const result = await work();
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      after?.();
      router.refresh();
    });

  function add(event: React.FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || pending) return;
    run(
      () => addMilestoneAction(goalId, { title: value, targetDate: date || null }),
      () => {
        setTitle("");
        setDate("");
      },
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...milestones];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderMilestonesAction(goalId, next.map((milestone) => milestone.id)));
  }

  function remove(milestone: Milestone) {
    if (!window.confirm(`Delete the milestone "${milestone.title}"?`)) return;
    run(() => deleteMilestoneAction(goalId, milestone.id), () => toast("Milestone deleted."));
  }

  function saveTitle(milestone: Milestone) {
    const value = draft.trim();
    setEditing(null);
    if (!value || value === milestone.title) return;
    run(() => updateMilestoneAction(goalId, milestone.id, { title: value }));
  }

  return (
    <section className="goal-panel">
      <header>
        <h2>Milestones</h2>
        {milestones.length > 0 && (
          <span>
            {milestones.filter(isDone).length} of {counts.total} done
          </span>
        )}
      </header>

      {milestones.length === 0 ? (
        <p className="goal-panel-empty">
          Break the goal into steps you can actually finish. The first one is usually smaller
          than you think.
        </p>
      ) : (
        <ul className="milestone-list">
          {milestones.map((milestone, index) => {
            const done = isDone(milestone);
            return (
              <li key={milestone.id} className={done ? "is-done" : ""}>
                <button
                  type="button"
                  className="milestone-tick"
                  onClick={() => {
                    setOptimistic((prev) => ({ ...prev, [milestone.id]: !done }));
                    run(
                      async () => {
                        const result = await updateMilestoneAction(goalId, milestone.id, {
                          completed: !done,
                        });
                        if (result.error) {
                          setOptimistic((prev) => ({ ...prev, [milestone.id]: done }));
                        }
                        return result;
                      },
                      () => setOptimistic((prev) => ({ ...prev, [milestone.id]: !done })),
                    );
                  }}
                  aria-label={done ? `Mark ${milestone.title} incomplete` : `Complete ${milestone.title}`}
                  aria-pressed={done}
                  disabled={pending}
                >
                  {done ? <Check size={13} /> : null}
                </button>

                {editing === milestone.id ? (
                  <input
                    className="milestone-edit"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => saveTitle(milestone)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveTitle(milestone);
                      if (event.key === "Escape") setEditing(null);
                    }}
                    maxLength={160}
                  />
                ) : (
                  <button
                    type="button"
                    className="milestone-title"
                    onClick={() => {
                      setEditing(milestone.id);
                      setDraft(milestone.title);
                    }}
                  >
                    {milestone.title}
                    {milestone.targetDate && (
                      <em>
                        {new Date(milestone.targetDate).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        })}
                      </em>
                    )}
                  </button>
                )}

                <div className="milestone-tools">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || pending}
                    aria-label={`Move ${milestone.title} up`}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === milestones.length - 1 || pending}
                    aria-label={`Move ${milestone.title} down`}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(milestone)}
                    disabled={pending}
                    aria-label={`Delete ${milestone.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="milestone-add" onSubmit={add}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a milestone"
          maxLength={160}
        />
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-label="Milestone date"
        />
        <button type="submit" disabled={pending || !title.trim()}>
          {pending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
        </button>
      </form>

      {error && (
        <p className="goal-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
