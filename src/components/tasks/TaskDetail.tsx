"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, Check, ListTree, Loader2, StickyNote, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { deleteTaskAction, setTaskReminderAction, updateTaskDetailAction } from "@/app/(app)/actions";
import { Attachments, type AttachmentData } from "@/components/events/Attachments";

/**
 * A task, opened.
 *
 * The rule here is that nothing empty is drawn. A task with no note shows no
 * note section — not a card headed "Notes" containing the word "None", which is
 * how a detail view ends up feeling like a form with most of the fields blank.
 * Adding a note is a button; once there is one, it becomes a section.
 *
 * Everything visible is editable in place, and every edit saves on blur rather
 * than behind a Save button, because there is nothing here worth confirming.
 */

export interface TaskDetailData {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  dueHasTime: boolean;
  subtasks: { id: string; title: string; status: string }[];
  reminders: { id: string; remindAt: string }[];
  events: { id: string; title: string; kind: string; startAt: string; endAt: string; allDay: boolean }[];
  project: { name: string } | null;
  documents: AttachmentData[];
}

function formatWhen(iso: string, hasTime: boolean): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const day = sameDay(date, now)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(
          date,
        );

  if (!hasTime) return day;
  return `${day} · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskDetail({ task, onClose }: { task: TaskDetailData; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.description ?? "");
  const [showNote, setShowNote] = useState(Boolean(task.description));
  const [showDate, setShowDate] = useState(false);
  const [reminder, setReminder] = useState<string | null>(task.reminders[0]?.remindAt ?? null);
  const [showReminder, setShowReminder] = useState(Boolean(task.reminders[0]));
  /**
   * Held locally as well as on the server.
   *
   * `router.refresh()` re-renders the page behind the sheet, but this panel's
   * data came from a one-off fetch, so the prop never changes — the button kept
   * saying "Complete" after completing. The local copy is what the button
   * reads; the server call is what makes it true.
   */
  const [status, setStatus] = useState(task.status);
  const done = status === "DONE";
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (patch: Parameters<typeof updateTaskDetailAction>[1]) => {
    startTransition(async () => {
      const result = await updateTaskDetailAction(task.id, patch);
      if (result.error) toast(result.error, "error");
      else router.refresh();
    });
  };

  const saveReminder = (value: string | null) => {
    startTransition(async () => {
      const result = await setTaskReminderAction(task.id, value);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setReminder(result.remindAt ?? null);
      setShowReminder(Boolean(result.remindAt));
      router.refresh();
    });
  };

  return (
    <div className="task-sheet" role="dialog" aria-modal="true" aria-label={task.title}>
      <div className="task-sheet-scrim" onClick={onClose} />

      <div className="task-sheet-panel" ref={panel}>
        <header className="task-sheet-head">
          <button type="button" className="task-sheet-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <textarea
          className="task-sheet-title"
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (!next) {
              setTitle(task.title);
              return;
            }
            if (next !== task.title) save({ title: next });
          }}
          aria-label="Task title"
        />

        {/* The date, when there is one. Not an empty "Due" field otherwise. */}
        {task.dueAt && !showDate && (
          <button type="button" className="task-sheet-when" onClick={() => setShowDate(true)}>
            <CalendarDays size={14} /> {formatWhen(task.dueAt, task.dueHasTime)}
          </button>
        )}

        {showDate && (
          <div className="task-sheet-dateedit">
            <input
              type="datetime-local"
              defaultValue={task.dueAt ? toLocalInput(task.dueAt) : ""}
              onChange={(e) => {
                const date = new Date(e.target.value);
                if (Number.isNaN(date.getTime())) return;
                save({ dueAt: date.toISOString(), dueHasTime: true });
              }}
              aria-label="Due date"
            />
            <button
              type="button"
              onClick={() => {
                save({ dueAt: null });
                setShowDate(false);
              }}
            >
              Clear
            </button>
          </div>
        )}

        <button
          type="button"
          className={`task-sheet-complete ${done ? "is-done" : ""}`}
          disabled={pending}
          onClick={() => {
            const next = done ? "TODO" : "DONE";
            setStatus(next);
            save({ status: next });
          }}
        >
          {pending ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
          {done ? "Completed" : "Complete"}
        </button>

        {/* ---- Only what exists ---- */}

        {showNote ? (
          <section className="task-sheet-section">
            <h3>
              <StickyNote size={13} /> Note
            </h3>
            <textarea
              value={note}
              autoFocus={!task.description}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== (task.description ?? "")) save({ description: note.trim() || null });
              }}
              placeholder="Anything worth remembering…"
              rows={3}
            />
          </section>
        ) : null}

        {task.subtasks.length > 0 && (
          <section className="task-sheet-section">
            <h3>
              <ListTree size={13} /> Subtasks
              <em>
                {task.subtasks.filter((s) => s.status === "DONE").length}/{task.subtasks.length}
              </em>
            </h3>
            <ul className="task-sheet-subtasks">
              {task.subtasks.map((sub) => (
                <li key={sub.id} className={sub.status === "DONE" ? "is-done" : ""}>
                  <Check size={12} /> {sub.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {showReminder && (
          <section className="task-sheet-section">
            <h3>
              <Bell size={13} /> Reminder
            </h3>
            {reminder ? (
              <div className="task-sheet-reminder">
                <p className="task-sheet-line">{formatWhen(reminder, true)}</p>
                <button type="button" onClick={() => saveReminder(null)} disabled={pending}>Remove</button>
              </div>
            ) : (
              <div className="task-sheet-dateedit">
                <input
                  type="datetime-local"
                  aria-label="Reminder time"
                  defaultValue={task.dueAt ? toLocalInput(task.dueAt) : ""}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    saveReminder(new Date(event.target.value).toISOString());
                  }}
                />
              </div>
            )}
          </section>
        )}

        <section className="task-sheet-section task-sheet-attachments">
          <Attachments
            uploadUrl={`/api/tasks/${encodeURIComponent(task.id)}/attachments`}
            attachments={task.documents}
            title="Resources"
          />
        </section>

        {/* The distinction the architecture exists for: a deadline is a date on
            the task, an exam is an Event the task points at. */}
        {task.events.length > 0 && (
          <section className="task-sheet-section">
            <h3>
              <CalendarDays size={13} /> Related to
            </h3>
            {task.events.map((event) => (
              <button key={event.id} type="button" className="task-sheet-line task-sheet-event-link" onClick={() => { onClose(); router.push(`/events/${event.id}`); }}>
                <b>{event.title}</b>
                <span>{event.kind.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())} · {formatWhen(event.startAt, !event.allDay)}</span>
              </button>
            ))}
          </section>
        )}

        <footer className="task-sheet-foot">
          {!showNote && (
            <button type="button" onClick={() => setShowNote(true)}>
              <StickyNote size={13} /> Add note
            </button>
          )}
          {!task.dueAt && !showDate && (
            <button type="button" onClick={() => setShowDate(true)}>
              <CalendarDays size={13} /> Add date
            </button>
          )}
          {!showReminder && (
            <button type="button" onClick={() => setShowReminder(true)}>
              <Bell size={13} /> Set reminder
            </button>
          )}
          <button
            type="button"
            className="task-sheet-delete"
            onClick={() => {
              startTransition(async () => {
                await deleteTaskAction(task.id);
                toast(`Deleted “${task.title}”.`);
                onClose();
                router.refresh();
              });
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </footer>
      </div>
    </div>
  );
}
