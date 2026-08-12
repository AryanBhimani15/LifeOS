"use client";

import { FormEvent, useState, useTransition } from "react";
import { Check, Circle, Loader2, Plus } from "lucide-react";
import { addTodayTaskAction, completeTaskAction } from "@/app/(app)/actions";
import { useToast } from "@/components/ToastProvider";
import { useRouter } from "next/navigation";

type TodayTask = { id: string; title: string; done: boolean };

export function TodayTodoList({ initialTasks }: { initialTasks: TodayTask[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || pending) return;
    startTransition(async () => {
      const result = await addTodayTaskAction(title);
      if (result.error) return toast(result.error, "error");
      setTitle("");
      router.refresh();
    });
  }

  function toggle(task: TodayTask) {
    startTransition(async () => {
      await completeTaskAction(task.id);
      router.refresh();
    });
  }

  return (
    <section className="home-today-todos" aria-label="Today’s to-do list">
      <header><div><h2>Today&apos;s to-do list</h2><p>Everything added here is due today.</p></div><span>{initialTasks.filter((task) => !task.done).length} open</span></header>
      <form onSubmit={add}>
        <Plus size={17} />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add something for today…" aria-label="Add a task for today" maxLength={500} />
        <button type="submit" disabled={!title.trim() || pending}>{pending ? <Loader2 className="spin" size={16} /> : "Add"}</button>
      </form>
      {initialTasks.length ? <ul>{initialTasks.map((task) => <li key={task.id} className={task.done ? "is-done" : ""}><button type="button" onClick={() => toggle(task)} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}><span>{task.done ? <Check size={13} /> : <Circle size={15} />}</span>{task.title}</button></li>)}</ul> : <p className="home-today-empty">Your day is clear—add the first thing you want to finish.</p>}
    </section>
  );
}
