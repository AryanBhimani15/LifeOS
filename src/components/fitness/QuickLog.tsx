"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { calculateBurn, formatDuration } from "@/lib/fitness";
import * as api from "@/lib/fitness-api";
import type { Activity } from "@/lib/repositories/fitness";
import { ActivityIcon } from "./ActivityIcon";
import { ActivitySelector } from "./ActivitySelector";

/**
 * Log a workout, near the top of the page, in two fields.
 *
 * What this replaces was a "calculator": pick an activity, type hours AND
 * minutes, press Calculate, read the number, then press Save — five steps and a
 * scroll to the bottom of the page to reach them. Recording that you went to
 * the gym should not be a two-stage process.
 *
 * Calories are shown live as the duration changes rather than behind a button,
 * because the figure is a consequence of the two fields above it and not a
 * thing the user should have to ask for. Nobody wants to calculate; they want
 * it recorded.
 */
export function QuickLog({ activities }: { activities: Activity[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [minutes, setMinutes] = useState("45");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activity = activities.find((a) => a.id === activityId) ?? activities[0];
  const duration = Number(minutes.trim());
  const valid = Number.isInteger(duration) && duration > 0 && duration <= 1440;

  // Live, because it follows from the fields rather than from a decision.
  const calories = useMemo(
    () => (activity && valid ? calculateBurn(activity.caloriesPerHour, duration) : null),
    [activity, valid, duration],
  );

  const log = useCallback(async () => {
    if (!activityId) {
      setError("Choose an activity.");
      return;
    }
    if (!valid) {
      setError(
        duration <= 0 || Number.isNaN(duration)
          ? "Enter a duration greater than 0 minutes."
          : "That is longer than a day.",
      );
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // Sent as hours + minutes because that is the shape the API validates;
      // the field only asks for minutes, which is how people describe a workout.
      const entry = await api.saveWorkout(activityId, {
        hours: Math.floor(duration / 60),
        minutes: duration % 60,
      });
      toast(`${entry.activityName} logged — ${entry.caloriesBurned.toLocaleString()} kcal.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't log that.");
    } finally {
      setSaving(false);
    }
  }, [activityId, valid, duration, toast, router]);

  return (
    <form
      className="quick-log"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) log();
      }}
    >
      <div className="quick-log-fields">
        <label className="quick-log-activity">
          <span className="fit-label">Activity</span>
          <ActivitySelector
            activities={activities}
            value={activityId}
            onChange={(id) => {
              setActivityId(id);
              setError(null);
            }}
          />
        </label>

        <label className="quick-log-duration">
          <span className="fit-label">Duration</span>
          <span className="quick-log-minutes">
            <input
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value.replace(/[^\d]/g, "").slice(0, 4));
                setError(null);
              }}
              inputMode="numeric"
              aria-label="Duration in minutes"
            />
            <em>min</em>
          </span>
        </label>

        <button type="submit" className="quick-log-submit" disabled={saving}>
          {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
          Log workout
        </button>
      </div>

      <p className="quick-log-result">
        {activity && valid ? (
          <>
            <ActivityIcon icon={activity.icon} size={13} />
            {activity.name} · {formatDuration(duration)} ·{" "}
            <b>{calories?.toLocaleString()} kcal</b>
          </>
        ) : (
          <span className="quick-log-hint">Enter how long you went for.</span>
        )}
      </p>

      {error && (
        <p className="fit-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
