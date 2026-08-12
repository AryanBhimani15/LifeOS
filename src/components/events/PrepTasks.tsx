"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, Plus } from "lucide-react";
import { addPrepTaskAction, togglePrepTaskAction } from "@/app/(app)/events/actions";

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

export function PrepTasks({ eventId, tasks }: { eventId: string; tasks: PrepTask[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
                <span className="prep-title">{task.title}</span>
                {STATUS_LABEL[task.status] && (
                  <span className={`prep-status is-${task.status.toLowerCase()}`}>
                    {STATUS_LABEL[task.status]}
                  </span>
                )}
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
        {pending && <Loader2 size={14} className="spin" />}
      </form>

      {error && (
        <p className="add-task-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
