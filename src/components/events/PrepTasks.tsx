"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Circle, Link2, Loader2, Plus, X } from "lucide-react";
import { addPrepTaskAction, linkExistingPrepTaskAction, togglePrepTaskAction, unlinkPrepTaskAction } from "@/app/(app)/events/actions";

/**
 * Tasks for preparing for this event.
 *
 * Each one is an ordinary task — created by the same pipeline, visible on the
 * board, completable from either place. The link is the only thing that makes
 * it "preparation", and removing the event would leave the tasks standing.
 *
 * When there are none, this is a single line of input rather than an empty
 * panel headed "Preparation tasks (0)".
 */

export interface PrepTask {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  dueHasTime: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  DONE: "Done",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  TODO: "",
};

export function PrepTasks({ eventId, tasks, availableTasks }: { eventId: string; tasks: PrepTask[]; availableTasks: PrepTask[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);
  const [query, setQuery] = useState("");
  const choices = availableTasks.filter((task) => !tasks.some((linked) => linked.id === task.id) && task.title.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const add = () => {
    const value = text.trim();
    if (!value || pending) return;
    setText("");
    startTransition(async () => {
      const result = await addPrepTaskAction(eventId, value);
      if (result.error) {
        setError(result.error);
        setText(value);
      } else {
        setError(null);
        router.refresh();
      }
    });
  };

  const toggle = (task: PrepTask) => {
    startTransition(async () => {
      await togglePrepTaskAction(eventId, task.id, task.status === "DONE" ? "TODO" : "DONE");
      router.refresh();
    });
  };

  return (
    <section className="event-block">
      <div className="event-block-head">
        <h2>Tasks to prepare</h2>
        {tasks.length > 0 && (
          <span className="event-block-count">
            {tasks.filter((t) => t.status === "DONE").length}/{tasks.length}
          </span>
        )}
      </div>

      {tasks.length > 0 && (
        <ul className="prep-list">
          {tasks.map((task) => {
            const done = task.status === "DONE";
            return (
              <li key={task.id} className={done ? "is-done" : ""}>
                <button
                  type="button"
                  className="prep-check"
                  onClick={() => toggle(task)}
                  aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                  aria-pressed={done}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : <Circle size={14} strokeWidth={1.6} />}
                </button>
                <Link className="prep-title" href={`/tasks?focus=${task.id}`}>{task.title}</Link>
                {STATUS_LABEL[task.status] && (
                  <span className={`prep-status is-${task.status.toLowerCase()}`}>
                    {STATUS_LABEL[task.status]}
                  </span>
                )}
                <button className="prep-unlink" type="button" aria-label={`Remove ${task.title} from preparation`} title="Remove from preparation" disabled={pending} onClick={() => startTransition(async () => { await unlinkPrepTaskAction(eventId, task.id); router.refresh(); })}><X size={13} /></button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="prep-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={14} />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setText("");
          }}
          placeholder="Add a task to prepare…"
          maxLength={500}
          aria-label="Add a task to prepare"
        />
        <button type="submit" disabled={!text.trim() || pending} aria-label="Add preparation task">
          <Plus size={14} /> Add
        </button>
        {pending && <Loader2 size={14} className="spin" />}
      </form>

      {error && (
        <p className="add-task-error" role="alert">
          {error}
        </p>
      )}
      <div className="event-link-existing"><button type="button" onClick={() => setLinkOpen((open) => !open)}><Link2 size={13} /> Link an existing task</button>{linkOpen && <div className="event-picker"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your tasks…" aria-label="Search existing tasks" autoFocus />{choices.map((task) => <button key={task.id} type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await linkExistingPrepTaskAction(eventId, task.id); if (result.error) setError(result.error); else { setLinkOpen(false); setQuery(""); router.refresh(); } })}><b>{task.title}</b><span>{task.dueAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(task.dueAt)) : "No date"}</span></button>)}{choices.length === 0 && <p>No other tasks match.</p>}</div>}</div>
    </section>
  );
}
