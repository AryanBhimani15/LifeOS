"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark, Check, Flame, Loader2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { formatDuration } from "@/lib/fitness";
import { durationSchema } from "@/lib/validation/fitness";
import * as api from "@/lib/fitness-api";
import type { Activity, BurnResult } from "@/lib/repositories/fitness";
import { ActivityIcon } from "./ActivityIcon";
import { ActivitySelector } from "./ActivitySelector";

/**
 * The calculator: pick an activity, enter a duration, see the burn.
 *
 * The result is computed by the server rather than here. It would be one line
 * of arithmetic in the browser, but then the rate shown on screen and the rate
 * a saved entry is priced at would come from two different places, and they
 * would eventually disagree. One source, one answer.
 *
 * Calculating and saving are separate on purpose. Adjusting a duration to see
 * what it comes to is the normal way to use this, and every one of those
 * attempts landing in history would make the history useless.
 */
export function CalorieCalculator({
  activities,
  firstName,
}: {
  activities: Activity[];
  firstName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"calculating" | "saving" | null>(null);
  const [result, setResult] = useState<BurnResult | null>(null);
  const [saved, setSaved] = useState(false);
  // Bumped per calculation so the result card remounts and counts up from zero
  // again, instead of easing from the previous total.
  const [run, setRun] = useState(0);

  const readDuration = useCallback(() => {
    const parsed = durationSchema.safeParse({
      hours: hours.trim() === "" ? 0 : Number(hours),
      minutes: minutes.trim() === "" ? 0 : Number(minutes),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the duration.");
      return null;
    }
    return { hours: hours.trim() === "" ? 0 : Number(hours), minutes: minutes.trim() === "" ? 0 : Number(minutes) };
  }, [hours, minutes]);

  const calculate = useCallback(async () => {
    const duration = readDuration();
    if (!duration) return;
    if (!activityId) {
      setError("Choose an activity first.");
      return;
    }

    setError(null);
    setBusy("calculating");
    try {
      const burn = await api.calculateBurn(activityId, duration);
      setResult(burn);
      setSaved(false);
      setRun((n) => n + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }, [activityId, readDuration]);

  const save = useCallback(async () => {
    const duration = readDuration();
    if (!duration || !result) return;

    setBusy("saving");
    try {
      await api.saveWorkout(activityId, duration);
      setSaved(true);
      toast(`${result.caloriesBurned.toLocaleString()} kcal added to your history.`);
      // The statistics above are server-rendered, so they need a fresh render
      // rather than a local state update — this keeps them and the database
      // from disagreeing.
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }, [activityId, readDuration, result, router, toast]);

  /** Digits only, and blank stays blank so a field can be cleared to retype. */
  const digits = (value: string) => value.replace(/[^\d]/g, "").slice(0, 4);

  return (
    <div className="fit-card fit-calculator">
      <div className="fit-field">
        <span className="fit-label">Activity</span>
        <ActivitySelector
          activities={activities}
          value={activityId}
          onChange={(id) => {
            setActivityId(id);
            setError(null);
          }}
        />
      </div>

      <div className="fit-field">
        <span className="fit-label">Duration</span>
        <div className="fit-duration">
          <div className="fit-duration-input">
            <input
              value={hours}
              onChange={(e) => {
                setHours(digits(e.target.value));
                setError(null);
              }}
              inputMode="numeric"
              aria-label="Hours"
            />
            <span>hours</span>
          </div>
          <div className="fit-duration-input">
            <input
              value={minutes}
              onChange={(e) => {
                setMinutes(digits(e.target.value));
                setError(null);
              }}
              inputMode="numeric"
              aria-label="Minutes"
            />
            <span>minutes</span>
          </div>
        </div>
      </div>

      {error && (
        <p className="fit-error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="fit-primary" onClick={calculate} disabled={busy !== null}>
        {busy === "calculating" ? (
          <>
            <Loader2 size={16} className="spin" /> Calculating
          </>
        ) : (
          <>
            Calculate calories <ArrowRight size={16} />
          </>
        )}
      </button>

      {result && (
        <ResultCard
          key={run}
          result={result}
          firstName={firstName}
          saved={saved}
          saving={busy === "saving"}
          onSave={save}
        />
      )}
    </div>
  );
}

function ResultCard({
  result,
  firstName,
  saved,
  saving,
  onSave,
}: {
  result: BurnResult;
  firstName: string;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const counted = useAnimatedNumber(result.caloriesBurned, { from: 0, duration: 900 });

  return (
    <div className="fit-result">
      <span className="fit-result-flame">
        <Flame size={20} />
      </span>

      <b className="fit-result-number">{Math.round(counted).toLocaleString()}</b>
      <span className="fit-result-unit">kcal burned</span>

      <p className="fit-result-detail">
        <ActivityIcon icon={result.activityIcon} size={14} />
        {result.activityName} · {formatDuration(result.durationMinutes)}
        <em>{result.caloriesPerHour} kcal/hour</em>
      </p>

      {saved ? (
        <p className="fit-result-saved">
          <Check size={14} /> Saved{firstName ? `, ${firstName}` : ""} — it&apos;s in your history.
        </p>
      ) : (
        <button type="button" className="fit-secondary" onClick={onSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 size={15} className="spin" /> Saving
            </>
          ) : (
            <>
              <Bookmark size={15} /> Save to history
            </>
          )}
        </button>
      )}
    </div>
  );
}
