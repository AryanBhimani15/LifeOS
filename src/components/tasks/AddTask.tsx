"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, Check, Loader2, Plus, StickyNote, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { parseCapture } from "@/lib/nlp/parse-capture";
import { addTaskAction, type AddTaskResult } from "@/app/(app)/actions";

/**
 * The one place a task is created.
 *
 * The shape of this is the whole point of the feature: type, optionally pick a
 * day, add. There is no project, no priority, no status and no type — those are
 * organisation, and organisation is something you do to a task later, if ever.
 * Anything beyond the sentence lives behind a disclosure that most captures
 * will never open.
 *
 * The date is read from the sentence as you type and shown as a chip, so
 * "renew domain tomorrow" needs no second step. Tapping a chip overrides the
 * reading; clearing it means no date at all, which is different from not having
 * said one and is passed through as such.
 */

type Chip = "today" | "tomorrow" | "week" | "pick";

interface Resolved {
  /** Local ISO the server can parse, or null for "deliberately no date". */
  iso: string | null;
  hasTime: boolean;
  label: string;
}

/** End of the given local day — a deadline is "by then", not "at midnight". */
function endOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function chipDate(chip: Exclude<Chip, "pick">): Date {
  const now = new Date();
  if (chip === "today") return endOfLocalDay(now);
  if (chip === "tomorrow") return endOfLocalDay(addDays(now, 1));
  // "This week" is the end of it — Sunday, or today if it already is.
  const daysToSunday = (7 - now.getDay()) % 7;
  return endOfLocalDay(addDays(now, daysToSunday));
}

function formatWhen(date: Date, hasTime: boolean): string {
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  const day = sameDay(date, now)
    ? "Today"
    : sameDay(date, addDays(now, 1))
      ? "Tomorrow"
      : new Intl.DateTimeFormat("en-US", {
          weekday: date.getTime() - now.getTime() < 6 * 86_400_000 ? "long" : undefined,
          month: "short",
          day: "numeric",
        }).format(date);

  if (!hasTime) return day;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} · ${time}`;
}

/** A `datetime-local` value for a Date, in the browser's own zone. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AddTask({
  placeholder = "What do you need to do?",
  autoFocus = false,
  onAdded,
}: {
  placeholder?: string;
  autoFocus?: boolean;
  onAdded?: (result: AddTaskResult) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [override, setOverride] = useState<Resolved | null>(null);
  const [note, setNote] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The same parser the server uses, run as you type purely to preview what it
   * will do. The server parses again on submit — this copy is a courtesy, never
   * the source of truth.
   */
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseCapture(text, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [text]);

  const shown: Resolved | null = override
    ? override
    : parsed?.dueAt
      ? {
          iso: parsed.dueAt.toISOString(),
          hasTime: parsed.dueHasTime,
          label: formatWhen(parsed.dueAt, parsed.dueHasTime),
        }
      : null;

  const title = parsed?.title ?? text.trim();

  const reset = useCallback(() => {
    setText("");
    setOverride(null);
    setNote("");
    setRemindAt("");
    setShowNote(false);
    setShowReminder(false);
    setShowPicker(false);
    setError(null);
  }, []);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || pending) return;

    startTransition(async () => {
      const result = await addTaskAction({
        text: value,
        // `undefined` lets the server read the sentence; an explicit choice
        // (including "no date") is sent through as itself.
        ...(override ? { dueAt: override.iso, dueHasTime: override.hasTime } : {}),
        note: note.trim() || null,
        remindAt: remindAt ? new Date(remindAt).toISOString() : null,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      toast(`Added “${result.task?.title ?? value}”.`);
      reset();
      inputRef.current?.focus();
      router.refresh();
      onAdded?.(result);
    });
  }, [text, pending, override, note, remindAt, toast, reset, router, onAdded]);

  const pickChip = (chip: Chip) => {
    setError(null);
    if (chip === "pick") {
      setShowPicker((v) => !v);
      return;
    }
    const date = chipDate(chip);
    setOverride({ iso: date.toISOString(), hasTime: false, label: formatWhen(date, false) });
    setShowPicker(false);
  };

  return (
    <div className="add-task">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="add-task-field">
          <Plus size={16} />
          <input
            ref={inputRef}
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            maxLength={500}
            aria-label="What do you need to do?"
          />

          {/* What the sentence was understood to mean, always visible and
              always removable. A date the user cannot see is a date they
              cannot correct. */}
          {shown && (
            <button
              type="button"
              className="add-task-when"
              onClick={() => setOverride({ iso: null, hasTime: false, label: "" })}
              title="Remove the date"
            >
              <CalendarDays size={13} /> {shown.label} <X size={12} />
            </button>
          )}

          <button type="submit" className="add-task-submit" disabled={!text.trim() || pending}>
            {pending ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            <span>Add</span>
          </button>
        </div>

        {/* The title after the date is stripped out, so it is obvious that
            "tomorrow" became a date rather than part of the name. */}
        {shown && title && title !== text.trim() && (
          <p className="add-task-preview">
            Saving as <b>{title}</b>
          </p>
        )}

        <div className="add-task-row">
          <div className="add-task-chips" role="group" aria-label="When">
            <button type="button" onClick={() => pickChip("today")}>
              Today
            </button>
            <button type="button" onClick={() => pickChip("tomorrow")}>
              Tomorrow
            </button>
            <button type="button" onClick={() => pickChip("week")}>
              This week
            </button>
            <button
              type="button"
              className={showPicker ? "is-open" : ""}
              onClick={() => pickChip("pick")}
            >
              <CalendarDays size={13} /> Pick
            </button>
          </div>

          <div className="add-task-optional">
            <button
              type="button"
              className={showNote ? "is-on" : ""}
              onClick={() => setShowNote((v) => !v)}
            >
              <StickyNote size={13} /> Note
            </button>
            <button
              type="button"
              className={showReminder ? "is-on" : ""}
              onClick={() => setShowReminder((v) => !v)}
            >
              <Bell size={13} /> Remind
            </button>
          </div>
        </div>

        {showPicker && (
          <input
            type="datetime-local"
            className="add-task-picker"
            defaultValue={toLocalInput(shown?.iso ? new Date(shown.iso) : chipDate("today"))}
            onChange={(e) => {
              const date = new Date(e.target.value);
              if (Number.isNaN(date.getTime())) return;
              setOverride({ iso: date.toISOString(), hasTime: true, label: formatWhen(date, true) });
            }}
            aria-label="Pick a date and time"
          />
        )}

        {showNote && (
          <textarea
            className="add-task-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            maxLength={10_000}
            aria-label="Note"
          />
        )}

        {showReminder && (
          <input
            type="datetime-local"
            className="add-task-picker"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            aria-label="Remind me at"
          />
        )}

        {error && (
          <p className="add-task-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
