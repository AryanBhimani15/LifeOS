"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, GripVertical, Trash2 } from "lucide-react";
import { completeTaskAction, deleteTaskAction, moveTaskAction } from "@/app/(app)/actions";
import { AddTask } from "@/components/tasks/AddTask";
import { TaskDetailLoader } from "@/components/tasks/TaskDetailLoader";
import { useToast } from "./ToastProvider";

/**
 * Kanban board.
 *
 * Drag-and-drop writes through `moveTaskAction`, which recomputes the task's
 * fractional rank server-side and rebalances the column when the gap between
 * neighbours gets too small to split.
 *
 * Board state uses `useOptimistic` rather than `useState(initialTasks)`. That
 * matters: `useState` snapshots props on first render, so after a server action
 * called `revalidatePath` and the server sent fresh rows, the board kept showing
 * its original snapshot — tasks were created successfully and never appeared.
 * `useOptimistic` treats the server data as authoritative and re-syncs whenever
 * new props arrive, while still allowing an instant local update mid-action.
 */

type Optimistic =
  | { kind: "move"; taskId: string; status: Status }
  | { kind: "delete"; taskId: string };

function applyOptimistic(tasks: Task[], action: Optimistic): Task[] {
  switch (action.kind) {
    case "move":
      return tasks.map((t) => (t.id === action.taskId ? { ...t, status: action.status } : t));
    case "delete":
      return tasks.filter((t) => t.id !== action.taskId);
  }
}

type Status = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  boardOrder: number;
  subtaskCount: number;
  doneSubtasks: number;
  project: { name: string; color: string } | null;
  tags: { id: string; name: string; color: string }[];
}

const COLUMNS: { id: Status; label: string }[] = [
  { id: "TODO", label: "Todo" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "BLOCKED", label: "Blocked" },
  { id: "DONE", label: "Done" },
];

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "peach",
  HIGH: "yellow",
  MEDIUM: "blue",
  LOW: "lavender",
};

export function TaskBoard({ initialTasks }: { initialTasks: Task[] }) {
  const searchParams = useSearchParams();
  const [tasks, addOptimistic] = useOptimistic(initialTasks, applyOptimistic);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [filter, setFilter] = useState("");
  /** The task whose detail panel is showing, including a creation handoff. */
  const [open, setOpen] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    const openCreatedTask = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) setOpen(id);
    };
    window.addEventListener("lifeos:focus-task", openCreatedTask);
    return () => window.removeEventListener("lifeos:focus-task", openCreatedTask);
  }, []);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;
    // Deferring to the next frame lets the navigation commit before the panel
    // mounts. It avoids the stale-initial-state bug on client-side URL changes.
    const frame = requestAnimationFrame(() => setOpen(focus));
    return () => cancelAnimationFrame(frame);
  }, [searchParams]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? tasks.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            t.project?.name.toLowerCase().includes(needle) ||
            t.tags.some((tag) => tag.name.toLowerCase().includes(needle)),
        )
      : tasks;

    return COLUMNS.map((column) => ({
      ...column,
      tasks: matched
        .filter((t) => t.status === column.id)
        .sort((a, b) => a.boardOrder - b.boardOrder),
    }));
  }, [tasks, filter]);

  const sensors = useSensors(
    // A small distance threshold keeps a click on the card from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragStart(event: DragStartEvent) {
    setDragging(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const targetStatus = String(over.id) as Status;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;

    const column = tasks
      .filter((t) => t.status === targetStatus)
      .sort((a, b) => a.boardOrder - b.boardOrder);
    const afterId = column[column.length - 1]?.id ?? null;

    startTransition(async () => {
      // Optimistic updates must be applied inside the transition; React discards
      // them automatically once the server action's revalidation lands.
      addOptimistic({ kind: "move", taskId, status: targetStatus });
      try {
        await moveTaskAction({ taskId, status: targetStatus, beforeId: afterId, afterId: null });
      } catch {
        toast("Could not move that task.", "error");
      }
    });
  }

  function remove(task: Task) {
    startTransition(async () => {
      addOptimistic({ kind: "delete", taskId: task.id });
      try {
        await deleteTaskAction(task.id);
        toast(`Deleted “${task.title}”.`);
      } catch {
        toast("Could not delete that task.", "error");
      }
    });
  }

  function complete(task: Task) {
    startTransition(async () => {
      addOptimistic({ kind: "move", taskId: task.id, status: task.status === "DONE" ? "TODO" : "DONE" });
      try {
        await completeTaskAction(task.id);
        toast(task.status === "DONE" ? `Reopened “${task.title}”.` : `Completed “${task.title}”.`);
      } catch {
        toast("Could not update that task.", "error");
      }
    });
  }

  return (
    <>
      {open && (
        <TaskDetailLoader taskId={open} onClose={() => setOpen(null)} />
      )}

      <header className="topbar">
        <div>
          <p className="eyebrow">BOARD</p>
          <h1>Tasks</h1>
        </div>
        <div className="header-actions">
          <input
            className="board-filter"
            placeholder="Filter tasks…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter tasks"
          />
        </div>
      </header>

      <AddTask autoFocus />

      {/*
        An explicit id keeps dnd-kit's generated accessibility ids stable. Without
        it the library increments a global counter, so the server renders
        `DndDescribedBy-0` and the client hydrates `DndDescribedBy-9`, producing a
        hydration mismatch error in the console on every board render.
      */}
      <DndContext id="task-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="board">
          {visible.map((column) => (
            <Column key={column.id} id={column.id} label={column.label} count={column.tasks.length}>
              {column.tasks.length === 0 ? (
                <p className="board-empty">Nothing here.</p>
              ) : (
                column.tasks.map((task) => (
                  <Card
                    key={task.id}
                    task={task}
                    onDelete={() => remove(task)}
                    onOpen={() => setOpen(task.id)}
                    onComplete={() => complete(task)}
                  />
                ))
              )}
            </Column>
          ))}
        </div>

        <DragOverlay>
          {dragging && <CardBody task={dragging} dragging />}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  id,
  label,
  count,
  children,
}: {
  id: Status;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section className={`board-column ${isOver ? "is-over" : ""}`} ref={setNodeRef}>
      <header>
        <span>{label}</span>
        <b>{count}</b>
      </header>
      <div className="board-column-body">{children}</div>
    </section>
  );
}

function Card({
  task,
  onDelete,
  onOpen,
  onComplete,
}: {
  task: Task;
  onDelete: () => void;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? "board-card is-dragging" : "board-card"}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <button type="button" className="board-card-open" onClick={onOpen} aria-label={`Open ${task.title}`}>
        <CardBody task={task} />
      </button>
      <button
        type="button"
        className="card-drag-handle"
        aria-label={`Move ${task.title}`}
        title="Drag to move"
        onClick={(event) => event.stopPropagation()}
        {...listeners}
        {...attributes}
      >
        <GripVertical size={15} />
      </button>
      <button
        type="button"
        className={`card-complete ${task.status === "DONE" ? "is-done" : ""}`}
        aria-label={task.status === "DONE" ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onComplete(); }}
      >
        <Check size={13} />
      </button>
      <button
        className="card-delete"
        aria-label={`Delete ${task.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function CardBody({ task, dragging }: { task: Task; dragging?: boolean }) {
  const overdue = task.dueAt ? new Date(task.dueAt) < new Date() : false;

  return (
    <div className={dragging ? "board-card is-overlay" : "card-body"}>
      <div className="card-title">
        <span className={`task-dot ${PRIORITY_TONE[task.priority] ?? "blue"}`} />
        <b>{task.title}</b>
      </div>
      <div className="card-meta">
        {task.dueAt && (
          <span className={overdue ? "overdue" : ""}>
            {new Date(task.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
        {task.subtaskCount > 0 && (
          <span>
            {task.doneSubtasks}/{task.subtaskCount}
          </span>
        )}
        {task.project && <span className="card-project">{task.project.name}</span>}
        {task.tags.slice(0, 2).map((tag) => (
          <span key={tag.id} className="card-tag">
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  );
}
