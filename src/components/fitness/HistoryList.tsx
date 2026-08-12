"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { formatDuration } from "@/lib/fitness";
import * as api from "@/lib/fitness-api";
import type { HistoryEntry } from "@/lib/repositories/fitness";
import { ActivityIcon } from "./ActivityIcon";

/**
 * Saved workouts, newest first.
 *
 * Deleting asks first, but with a second click rather than a modal — a dialog
 * for removing one row of a list is heavier than the action deserves, and a bare
 * one-click delete on a list this dense is too easy to hit by accident. The
 * pending state times out on its own, so an accidental first click resolves to
 * nothing at all.
 */

const CONFIRM_TIMEOUT_MS = 4000;

export function HistoryList({
  entries,
  zone,
  emptyMessage = "Nothing logged yet.",
  compact = false,
}: {
  entries: HistoryEntry[];
  zone: string;
  emptyMessage?: string;
  /** Two-row layout, for the narrow sidebar where five columns do not fit. */
  compact?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Hidden the moment the server confirms, so the row does not linger until the
  // refreshed render arrives.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const arm = useCallback((id: string) => {
    setPending(id);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPending(null), CONFIRM_TIMEOUT_MS);
  }, []);

  const confirm = useCallback(
    async (entry: HistoryEntry) => {
      setDeleting(entry.id);
      try {
        await api.deleteWorkout(entry.id);
        setRemoved((prev) => new Set(prev).add(entry.id));
        setPending(null);
        toast(`${entry.activityName} removed from your history.`);
        router.refresh();
      } catch (failure) {
        toast(failure instanceof Error ? failure.message : "Couldn't delete that.", "error");
      } finally {
        setDeleting(null);
      }
    },
    [router, toast],
  );

  const visible = entries.filter((entry) => !removed.has(entry.id));

  if (visible.length === 0) {
    return <p className="fit-empty">{emptyMessage}</p>;
  }

  return (
    <ul className={`fit-history ${compact ? "is-compact" : ""}`}>
      {visible.map((entry) => (
        <li className={`fit-entry ${pending === entry.id ? "is-pending" : ""}`} key={entry.id}>
          <span className="fit-entry-icon">
            <ActivityIcon icon={entry.activityIcon} />
          </span>

          <span className="fit-entry-copy">
            <b>{entry.activityName}</b>
            <small>
              {formatDuration(entry.durationMinutes)} · {entry.caloriesPerHour} kcal/hr
            </small>
          </span>

          <span className="fit-entry-burn">
            {entry.caloriesBurned.toLocaleString()}
            <em>kcal</em>
          </span>

          <span className="fit-entry-when">{relativeLabel(entry.performedAt, zone)}</span>

          {pending === entry.id ? (
            <span className="fit-entry-confirm">
              <button
                type="button"
                className="fit-confirm-yes"
                onClick={() => confirm(entry)}
                disabled={deleting === entry.id}
                aria-label={`Confirm deleting ${entry.activityName}`}
              >
                {deleting === entry.id ? <Loader2 size={13} className="spin" /> : "Delete"}
              </button>
              <button
                type="button"
                className="fit-confirm-no"
                onClick={() => setPending(null)}
                aria-label="Keep this entry"
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="fit-entry-delete"
              onClick={() => arm(entry.id)}
              aria-label={`Delete ${entry.activityName}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Today · 5:42 PM" for recent entries, a date for older ones.
 *
 * The zone comes from the user's settings rather than the browser so the label
 * agrees with the day the entry was counted against in the statistics.
 */
function relativeLabel(when: Date | string, zone: string): string {
  const date = typeof when === "string" ? new Date(when) : when;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(date);

  const day = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: zone,
    }).format(value);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);

  if (day(date) === day(now)) return `Today · ${time}`;
  if (day(date) === day(yesterday)) return `Yesterday · ${time}`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(date);
}
