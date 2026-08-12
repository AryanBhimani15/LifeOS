"use client";

import { useEffect } from "react";
import { Bell, Check, Folder, MoreHorizontal, StickyNote, Star } from "lucide-react";

const SPARKS = [
  { x: -34, y: -16, d: 0 },
  { x: 31, y: -22, d: 65 },
  { x: -25, y: 20, d: 110 },
  { x: 34, y: 14, d: 38 },
  { x: 1, y: -37, d: 88 },
  { x: -40, y: 2, d: 135 },
];

/**
 * Success is deliberately a complete state, not a toast. The task is already
 * in the database when this mounts, and the preview comes from that response —
 * no optimistic fiction, no guessed deadline.
 */
export function TaskAdded({
  title,
  when,
  onViewTask,
  onAddAnother,
}: {
  title: string;
  when: string | null;
  onViewTask: () => void;
  onAddAnother: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAddAnother();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onViewTask();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAddAnother, onViewTask]);

  return (
    <section className="task-added" role="status" aria-live="polite" aria-label="Task added">
      <div className="task-added-celebration" aria-hidden="true">
        <span className="task-added-halo" />
        <span className="task-added-mark">
          <Check size={23} strokeWidth={2.6} />
          {SPARKS.map((spark, index) => (
            <i
              key={index}
              style={
                {
                  "--x": `${spark.x}px`,
                  "--y": `${spark.y}px`,
                  animationDelay: `${spark.d}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      </div>

      <div className="task-added-heading">
        <h2>Task added!</h2>
        <p>You&apos;re all set.</p>
      </div>

      <article className="task-added-preview">
        <div className="task-added-preview-title">
          <span className="task-added-status" />
          <b>{title}</b>
          <Star size={18} aria-label="Mark as important" />
        </div>
        {when && <span className="task-added-date">{when}</span>}
        <span className="task-added-todo">Todo</span>

        <div className="task-added-rule" />
        <div className="task-added-options" aria-label="Optional task organization">
          <span><Folder size={16} /> Add to project</span>
          <span><StickyNote size={16} /> Add notes</span>
          <span><Bell size={16} /> Set reminder</span>
          <span><MoreHorizontal size={17} /> More options</span>
        </div>
      </article>

      <button type="button" className="task-added-view" onClick={onViewTask}>
        View task
      </button>
      <button type="button" className="task-added-again" onClick={onAddAnother}>
        Add another task
      </button>
    </section>
  );
}
