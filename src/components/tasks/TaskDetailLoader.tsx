"use client";

import { useEffect, useState } from "react";
import { TaskDetail, type TaskDetailData } from "./TaskDetail";

/**
 * Fetches a task's detail when its panel opens.
 *
 * The board deliberately does not carry subtasks, reminders and events for
 * every card — that would be four joins on a list nobody has opened yet. They
 * are loaded once, on demand, for the one task being looked at.
 */
export function TaskDetailLoader({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const [task, setTask] = useState<TaskDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/detail`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(payload?.error?.message ?? "Couldn't open that task.");
          return;
        }
        setTask({
          ...payload,
          dueAt: payload.dueAt ?? null,
          reminders: payload.reminders ?? [],
          subtasks: payload.subtasks ?? [],
          event: payload.events?.[0] ?? null,
        });
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error) {
    return (
      <div className="task-sheet" role="dialog" aria-modal="true">
        <div className="task-sheet-scrim" onClick={onClose} />
        <div className="task-sheet-panel">
          <p className="add-task-error">{error}</p>
        </div>
      </div>
    );
  }

  if (!task) return null;
  return <TaskDetail task={task} onClose={onClose} />;
}
