"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { formatDuration } from "@/lib/fitness";
import * as api from "@/lib/fitness-api";
import type { PlanSessionView } from "@/lib/repositories/onboarding";
import { ActivityIcon } from "./ActivityIcon";

/**
 * Today's planned sessions, each logged with one tap.
 *
 * The calculator asks for an activity and a duration because an ad-hoc workout
 * has neither until you say so. A planned session already has both, so asking
 * again is just making the user retype something the app wrote down for them.
 * That was the whole complaint: logging felt like filling in a form.
 */
export function PlanToday({
  sessions,
  restMessage = "Rest day. Nothing planned — enjoy it.",
}: {
  sessions: PlanSessionView[];
  restMessage?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Ticked immediately on success rather than waiting for the refreshed render,
  // so the tap feels like it did something.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());

  if (sessions.length === 0) {
    return <p className="fit-empty">{restMessage}</p>;
  }

  const log = async (session: PlanSessionView) => {
    setBusy(session.id);
    try {
      const entry = await api.logPlannedSession(session.id);
      setJustDone((prev) => new Set(prev).add(session.id));
      toast(`${entry.activityName} logged — ${entry.caloriesBurned.toLocaleString()} kcal.`);
      router.refresh();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't log that.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="plan-today">
      {sessions.map((session) => {
        const done = session.doneToday || justDone.has(session.id);
        return (
          <li className={`plan-session ${done ? "is-done" : ""}`} key={session.id}>
            <span className="plan-session-icon">
              <ActivityIcon icon={session.activityIcon} />
            </span>

            <span className="plan-session-copy">
              <b>{session.activityName}</b>
              <small>
                {session.focus} · {formatDuration(session.durationMinutes)} ·{" "}
                {session.estimatedCalories.toLocaleString()} kcal
              </small>
            </span>

            {done ? (
              <span className="plan-session-done">
                <Check size={14} /> Done
              </span>
            ) : (
              <button
                type="button"
                className="plan-session-log"
                onClick={() => log(session)}
                disabled={busy !== null}
              >
                {busy === session.id ? <Loader2 size={14} className="spin" /> : "Log it"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
