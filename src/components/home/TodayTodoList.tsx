"use client";

import { FormEvent, useState, useTransition } from "react";
import { Check, ChevronRight, Circle, Loader2, Plus } from "lucide-react";
import { addTodayTaskAction, completeTaskAction } from "@/app/(app)/actions";
import { useToast } from "@/components/ToastProvider";
import { useRouter } from "next/navigation";

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type TodayTask = {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  project: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
};

function taskMeta(task: TodayTask, timeZone: string) {
  const bits: string[] = [];
  if (task.priority === "HIGH" || task.priority === "URGENT") bits.push(task.priority === "URGENT" ? "Urgent" : "High priority");
  if (task.project) bits.push(task.project);
  if (task.dueAt && task.dueHasTime) {
    bits.push(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(task.dueAt)));
  }
  return bits.join(" · ");
}

/** The first input on Home. Enter writes through the canonical capture path. */
export function TodayTodoList({ initialTasks, timeZone }: { initialTasks: TodayTask[]; timeZone: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [tasks, setTasks] = useState(initialTasks);
  const [pending, startTransition] = useTransition();

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = title.trim();
    if (!text || pending) return;

    const temporaryId = `home-pending-${Date.now()}`;
    setTasks((current) => [...current, {
      id: temporaryId,
      title: text,
      done: false,
      priority: "MEDIUM",
      project: null,
      dueAt: null,
      dueHasTime: false,
    }]);
    setTitle("");

    startTransition(async () => {
      const result = await addTodayTaskAction(text);
      if (result.error || !result.task) {
        setTasks((current) => current.filter((task) => task.id !== temporaryId));
        toast(result.error ?? "Couldn’t add that task.", "error");
        return;
      }
      setTasks((current) => current.map((task) => task.id === temporaryId ? {
        id: result.task!.id,
        title: result.task!.title,
        done: false,
        priority: result.task!.priority,
        project: null,
        dueAt: result.task!.dueAt,
        dueHasTime: result.task!.dueHasTime,
      } : task));
      router.refresh();
    });
  }

  function toggle(task: TodayTask) {
    if (pending || task.id.startsWith("home-pending-")) return;
    const nextDone = !task.done;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done: nextDone } : item));
    startTransition(async () => {
      try {
        await completeTaskAction(task.id);
        router.refresh();
      } catch {
        setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done: task.done } : item));
        toast("Couldn’t update that task.", "error");
      }
    });
  }

  return (
    <>
      <section className="home-fast-capture" aria-label="Fast task capture">
        <form onSubmit={add}>
          <Plus size={18} aria-hidden="true" />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // A real submit already handles Enter in browsers. Calling
              // requestSubmit as well keeps keyboard capture reliable through
              // embedded web views that swallow the implicit form submit.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Capture anything…"
            aria-label="Add a task for today"
            maxLength={500}
          />
          <button type="submit" disabled={!title.trim() || pending}>{pending ? <Loader2 className="spin" size={16} /> : "Add task"}</button>
        </form>
        <p>Task by default · press Enter to save</p>
      </section>

      <section className="home-today-todos" aria-label="Today’s to-do list">
        <header><div><h2>Today</h2><p>What you want to finish today.</p></div><span>{tasks.filter((task) => !task.done).length} open</span></header>
        {tasks.length ? <ul>{tasks.map((task) => <li key={task.id} className={task.done ? "is-done" : ""}>
          <button className="home-todo-check" type="button" onClick={() => toggle(task)} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}>
            <span>{task.done ? <Check size={13} /> : <Circle size={16} />}</span>
          </button>
          <button className="home-todo-row" type="button" onClick={() => router.push(`/tasks?focus=${task.id}`)} disabled={task.id.startsWith("home-pending-")}>
            <b>{task.title}</b>
            {taskMeta(task, timeZone) && <small>{taskMeta(task, timeZone)}</small>}
          </button>
          <ChevronRight className="home-todo-open" size={16} aria-hidden="true" />
        </li>)}</ul> : <p className="home-today-empty">Your day is clear.<br />Add the first thing you want to finish.</p>}
      </section>
    </>
  );
}
