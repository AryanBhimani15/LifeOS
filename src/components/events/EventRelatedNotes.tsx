"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { addEventRelatedNoteAction, setEventNoteRelationAction } from "@/app/(app)/events/actions";

type Note = { id: string; title: string; content: string; updatedAt: string };

/** The event-specific view of ordinary notes. It never creates a second note
 * record: attach/detach only updates Note.eventId. */
export function EventRelatedNotes({ eventId, notes, availableNotes }: { eventId: string; notes: Note[]; availableNotes: Note[] }) {
  const [draft, setDraft] = useState("");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => availableNotes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6), [availableNotes, query]);

  const run = (work: () => Promise<{ error?: string }>) => startTransition(async () => {
    const result = await work();
    if (!result.error) { setDraft(""); setQuery(""); setLinking(false); router.refresh(); }
  });

  return <section className="event-block event-related-notes">
    <div className="event-block-head"><h2>Related notes</h2><span className="event-block-count">{notes.length || ""}</span></div>
    {notes.length > 0 && <ul className="event-note-list">
      {notes.map((note) => <li key={note.id}><div><b>{note.title}</b><p>{note.content}</p></div><button type="button" title="Remove from this event" aria-label={`Remove ${note.title} from this event`} disabled={pending} onClick={() => run(() => setEventNoteRelationAction(eventId, note.id, false))}><Trash2 size={14} /></button></li>)}
    </ul>}
    <div className="event-related-note-create"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Add a note about this event…" aria-label="Add a related note" /><button type="button" disabled={!draft.trim() || pending} onClick={() => run(() => addEventRelatedNoteAction(eventId, draft))}>{pending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Save note</button></div>
    <div className="event-link-existing"><button type="button" onClick={() => setLinking((open) => !open)}><Link2 size={13} /> Link an existing note</button>{linking && <div className="event-picker"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes…" aria-label="Search existing notes" />{filtered.map((note) => <button key={note.id} type="button" disabled={pending} onClick={() => run(() => setEventNoteRelationAction(eventId, note.id, true))}><b>{note.title}</b><span>{note.content}</span></button>)}{filtered.length === 0 && <p>No standalone notes match.</p>}</div>}</div>
  </section>;
}
