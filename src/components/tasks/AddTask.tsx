"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, CheckSquare, GraduationCap, Loader2, Plus, SlidersHorizontal, StickyNote, X } from "lucide-react";
import { parseCapture } from "@/lib/nlp/parse-capture";
import { addEventAction, addTaskAction, type AddTaskResult } from "@/app/(app)/actions";
import { TaskAdded } from "./TaskAdded";

type CaptureKind = "TASK" | "EXAM" | "EVENT" | "REMINDER";
const TYPES: { id: CaptureKind; label: string; detail: string; Icon: typeof CheckSquare }[] = [
  { id: "TASK", label: "Task", detail: "Something to do", Icon: CheckSquare },
  { id: "EXAM", label: "Exam", detail: "An exam or test", Icon: GraduationCap },
  { id: "EVENT", label: "Event", detail: "Something on calendar", Icon: CalendarDays },
  { id: "REMINDER", label: "Reminder", detail: "Get reminded", Icon: Bell },
];

function localDate(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
function quickDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}
function endOfWeek() {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return localDate(date);
}
function labelDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

/** The single, type-aware capture sheet used by Today and the task board. */
export function AddTask({ placeholder = "What do you need to do?", onAdded }: { placeholder?: string; autoFocus?: boolean; onAdded?: (result: AddTaskResult) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CaptureKind>("TASK");
  const [text, setText] = useState("");
  // `null` means “let natural-language detection drive this field”; an empty
  // string is a deliberate user choice to clear it. That distinction lets a
  // sentence such as “CIA on Friday” fill in the date without an effect.
  const [manualDate, setManualDate] = useState<string | null>(null);
  const [manualTime, setManualTime] = useState<string | null>(null);
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [editingDate, setEditingDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<{ title: string; when: string | null; href: string } | null>(null);

  const parsed = useMemo(() => text.trim() ? parseCapture(text, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : null, [text]);
  const detectedDate = parsed?.dueAt ? localDate(parsed.dueAt) : "";
  const detectedTime = parsed?.dueAt && parsed.dueHasTime
    ? `${String(parsed.dueAt.getHours()).padStart(2, "0")}:${String(parsed.dueAt.getMinutes()).padStart(2, "0")}`
    : "";
  const date = manualDate ?? detectedDate;
  const time = manualTime ?? detectedTime;
  useEffect(() => {
    if (!open || success) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, success]);

  const close = () => { if (!pending) { setOpen(false); setSuccess(null); setError(null); } };
  const reset = () => { setText(""); setManualDate(null); setManualTime(null); setPriority("MEDIUM"); setEditingDate(false); setShowTime(false); setNote(""); setShowMore(false); setKind("TASK"); setError(null); };
  const setQuick = (value: string) => { setManualDate(value); setError(null); };

  const submit = () => {
    if (!text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "EXAM" || kind === "EVENT") {
          const result = await addEventAction({ text: parsed?.title || text, kind, date, time: time || null, note });
          if (result.error || !result.event) return setError(result.error ?? "Couldn't add that event.");
          setSuccess({ title: result.event.title, when: date ? `${labelDate(date)}${time ? ` · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time}`))}` : ""}` : null, href: `/events/${result.event.id}` });
        } else {
          const dueAt = date ? new Date(`${date}T${time || "23:59"}`).toISOString() : undefined;
          const result = await addTaskAction({ text, ...(dueAt ? { dueAt, dueHasTime: Boolean(time) } : {}), priority, note: note || null, remindAt: kind === "REMINDER" && date && time ? dueAt : null });
          if (result.error || !result.task) return setError(result.error ?? "Couldn't add task.");
          setSuccess({ title: result.task.title, when: result.task.dueAt ? `${labelDate(date)}${time ? ` · ${time}` : ""}` : null, href: `/tasks?focus=${result.task.id}` });
          onAdded?.(result);
        }
        reset();
        router.refresh();
      } catch { setError("Couldn't save that. Your text is still here — try again."); }
    });
  };

  return <>
    <button type="button" className="task-capture-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog"><span><Plus size={17} /> {placeholder}</span><span className="task-capture-launcher-action">Add something</span></button>
    {open && <div className="task-create-dialog" role="dialog" aria-modal="true" aria-label="Add something">
      <button type="button" className="task-create-scrim" aria-label="Close add" onClick={close} />
      <div className="task-create-panel task-create-expanded">
        {success ? <TaskAdded title={success.title} when={success.when} onAddAnother={() => { setSuccess(null); requestAnimationFrame(() => input.current?.focus()); }} onViewTask={() => { setOpen(false); router.push(success.href); }} /> :
          <form className="task-create-form task-create-unified" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <button type="button" className="task-create-close" onClick={close} aria-label="Close"><X size={18} /></button>
            <header className="task-create-title"><span><Plus size={16} /></span><h2>Add something</h2></header>
            <div className="task-create-prompt"><input ref={input} value={text} onChange={(event) => { setText(event.target.value); setError(null); }} placeholder="What would you like to add?" maxLength={500} /><span>✦</span></div>
            <div className="capture-types">{TYPES.map(({ id, label, detail, Icon }) => <button key={id} type="button" className={kind === id ? "is-selected" : ""} onClick={() => setKind(id)}><Icon size={19} /><span><b>{label}</b><small>{detail}</small></span></button>)}</div>
            {parsed?.dueAt && !editingDate ? <div className="capture-detected"><CalendarDays size={14} /><span>Due {labelDate(date)}{time ? ` · ${time}` : ""}</span><button type="button" onClick={() => setEditingDate(true)}>Change</button></div> : <div className="capture-schedule">
              <button type="button" onClick={() => setQuick(quickDate(0))}><CalendarDays size={15} /> Today</button><button type="button" onClick={() => setQuick(quickDate(1))}>Tomorrow</button><button type="button" onClick={() => setQuick(endOfWeek())}>This week</button>
              <label><CalendarDays size={15} /><input type="date" value={date} onChange={(event) => setManualDate(event.target.value)} aria-label="Date (optional for tasks)" /></label>
            </div>}
            <div className="capture-priority"><span><SlidersHorizontal size={14} /> Priority</span>{(["LOW", "MEDIUM", "HIGH"] as const).map((value) => <button key={value} type="button" className={priority === value ? `is-${value.toLowerCase()}` : ""} onClick={() => setPriority(value)}>{value[0]}{value.slice(1).toLowerCase()}</button>)}</div>
            <div className="capture-time-slider"><button type="button" onClick={() => setShowTime((shown) => !shown)}>{showTime ? "Remove time" : "Add time (optional)"}</button>{showTime && <><input type="range" min="0" max="1439" step="15" value={time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : 540} onChange={(event) => { const minutes = Number(event.target.value); setManualTime(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`); }} aria-label="Task time" /><strong>{time || "9:00 AM"}</strong></>}</div>
            {(kind === "EXAM" || kind === "EVENT") && !date && <p className="capture-date-help">Choose a date for an {kind.toLowerCase()}; time is optional.</p>}
            <button type="button" className="task-create-more" onClick={() => setShowMore((value) => !value)}><StickyNote size={15} /> <span>Add details or note</span></button>
            {showMore && <textarea className="capture-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Important details, preparation, or anything worth remembering…" rows={3} />}
            {error && <p className="task-create-error" role="alert">{error}</p>}
            <footer><button type="button" className="task-create-cancel" onClick={close}>Cancel</button><button type="submit" className="task-create-submit" disabled={!text.trim() || pending}>{pending && <Loader2 className="spin" size={15} />}{pending ? "Adding…" : "Add"}</button></footer>
            <p className="task-create-hint">Natural language works too! “DBMS CIA 2 on September 11 at 10am”</p>
          </form>}
      </div>
    </div>}
  </>;
}
