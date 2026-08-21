"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { setEventReminderAction } from "@/app/(app)/events/actions";

function localValue(iso: string) { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

const PRESETS = [
  { value: 0, label: "At time of event" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1_440, label: "1 day before" },
];

function relativeLabel(minutes: number) {
  return PRESETS.find((preset) => preset.value === minutes)?.label
    ?? `${minutes} minutes before`;
}

export function EventReminder({ eventId, reminder }: { eventId: string; reminder: { id: string; remindAt: string; relativeMinutesBefore: number | null } | null }) {
  const [editing, setEditing] = useState(!reminder);
  const router = useRouter();
  const [value, setValue] = useState(reminder ? localValue(reminder.remindAt) : "");
  const [mode, setMode] = useState<string>(reminder?.relativeMinutesBefore?.toString() ?? "60");
  const [pending, startTransition] = useTransition();
  const save = (next: string | null, relative: number | null = null) => startTransition(async () => {
    const result = await setEventReminderAction(eventId, next, relative);
    if (!result.error) { setEditing(false); router.refresh(); }
  });
  const selectedRelative = mode === "custom" ? null : Number(mode);

  return <section className="rail-card event-reminder"><div className="rail-head"><h3><Bell size={15} /> Reminder</h3></div>{reminder && !editing ? <div className="event-reminder-set"><p>{reminder.relativeMinutesBefore !== null ? relativeLabel(reminder.relativeMinutesBefore) : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(reminder.remindAt))}</p><button type="button" onClick={() => setEditing(true)}>Change</button><button type="button" onClick={() => save(null)} disabled={pending}>Remove</button></div> : <div className="event-reminder-edit"><select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="Event reminder timing">{PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}<option value="custom">Custom time</option></select>{mode === "custom" && <input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} aria-label="Custom event reminder time" />}<div className="event-reminder-actions"><button type="button" disabled={pending || (mode === "custom" && !value)} onClick={() => save(mode === "custom" ? new Date(value).toISOString() : null, selectedRelative)}>{pending ? <Loader2 size={13} className="spin" /> : "Save"}</button>{reminder && <button type="button" onClick={() => setEditing(false)}>Cancel</button>}</div></div>}</section>;
}
