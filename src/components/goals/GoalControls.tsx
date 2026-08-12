"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { deleteGoalAction, updateGoalAction } from "@/app/(app)/goals/actions";
import { useToast } from "@/components/ToastProvider";
import { formatAmount } from "@/lib/goals";

/**
 * The two things you do to a goal itself: move the number, and change its state.
 *
 * Only MANUAL and NUMERIC goals get an editable number here. For the other two
 * modes the figure belongs to the milestones or the tasks, and offering an
 * input that silently does nothing would be worse than offering none.
 */

export function ProgressControl({
  goalId,
  mode,
  percent,
  currentValue,
  targetValue,
  unit,
}: {
  goalId: string;
  mode: string;
  percent: number;
  currentValue: number;
  targetValue: number | null;
  unit: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    mode === "NUMERIC" ? String(currentValue) : String(percent),
  );
  const [error, setError] = useState<string | null>(null);

  if (mode === "MILESTONES") {
    return (
      <p className="goal-progress-note">
        This goal is measured by its milestones. Complete one to move the bar.
      </p>
    );
  }
  if (mode === "TASKS") {
    return (
      <p className="goal-progress-note">
        This goal is measured by its linked tasks. Finishing one anywhere in LifeOS moves the bar.
      </p>
    );
  }

  const numeric = mode === "NUMERIC";

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a number that is zero or more.");
      return;
    }

    startTransition(async () => {
      const result = await updateGoalAction(
        goalId,
        numeric ? { currentValue: parsed } : { manualPercent: Math.round(parsed) },
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      toast("Progress updated.");
      router.refresh();
    });
  }

  return (
    <form className="goal-progress-control" onSubmit={save}>
      <label>
        <span>{numeric ? "Where you are now" : "Percentage complete"}</span>
        <div>
          <input
            type="number"
            min="0"
            max={numeric ? undefined : 100}
            step="any"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <em>
            {numeric
              ? targetValue !== null
                ? `of ${formatAmount(targetValue, unit)}`
                : unit
              : "%"}
          </em>
          <button type="submit" disabled={pending}>
            {pending ? <Loader2 size={14} className="spin" /> : "Update"}
          </button>
        </div>
      </label>
      {error && (
        <p className="goal-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function GoalActions({
  goalId,
  title,
  status,
}: {
  goalId: string;
  title: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const achieved = status === "ACHIEVED";

  function setStatus() {
    startTransition(async () => {
      const result = await updateGoalAction(goalId, { status: achieved ? "ACTIVE" : "ACHIEVED" });
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      toast(achieved ? "Reopened." : `"${title}" achieved.`);
      router.refresh();
    });
  }

  function remove() {
    // A goal takes months to build and one click to lose, so the name has to be
    // in the question. Linked tasks and habits survive — worth saying, because
    // the fear of losing them is what makes people keep dead goals around.
    if (
      !window.confirm(
        `Delete "${title}"? Its milestones go with it. Linked tasks and habits stay where they are.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteGoalAction(goalId);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      toast("Goal deleted.");
      router.push("/goals");
    });
  }

  return (
    <div className="goal-actions">
      <button type="button" onClick={setStatus} disabled={pending} className="goal-secondary-button">
        {achieved ? <RotateCcw size={14} /> : <Check size={14} />}
        {achieved ? "Reopen" : "Mark achieved"}
      </button>
      <button type="button" onClick={remove} disabled={pending} className="goal-danger-button" aria-label={`Delete ${title}`}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
