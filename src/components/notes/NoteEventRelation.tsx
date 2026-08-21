"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, X } from "lucide-react";
import { setNoteEventAction } from "@/app/(app)/actions";

type Choice = { id: string; title: string; kind: string; startAt: string; allDay: boolean };

export function NoteEventRelation({ noteId, event, choices }: { noteId: string; event: Choice | null; choices: Choice[] }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [pending, startTransition] = useTransition();
  const router = useRouter();
  const matches = useMemo(() => choices.filter((choice) => choice.title.toLowerCase().includes(query.toLowerCase())).slice(0, 6), [choices, query]);
  const set = (eventId: string | null) => startTransition(async () => { const result = await setNoteEventAction(noteId, eventId); if (!result.error) { setOpen(false); setQuery(""); router.refresh(); } });
  return <div className="note-event-relation">{event ? <span><Link2 size={12} /> Related to <b>{event.title}</b><button type="button" aria-label={`Remove ${event.title} connection`} onClick={() => set(null)} disabled={pending}><X size={12} /></button></span> : <button type="button" onClick={() => setOpen((value) => !value)}><Link2 size={12} /> Relate to an event</button>}{open && <div className="event-picker"><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events and exams…" aria-label="Search events" />{matches.map((choice) => <button key={choice.id} type="button" disabled={pending} onClick={() => set(choice.id)}><b>{choice.title}</b><span>{choice.kind.toLowerCase()} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(choice.startAt))}</span></button>)}{pending && <Loader2 size={13} className="spin" />}{matches.length === 0 && <p>No events match.</p>}</div>}</div>;
}
