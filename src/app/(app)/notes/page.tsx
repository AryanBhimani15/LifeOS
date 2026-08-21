import { FileText, Trash2 } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { deleteNoteAction } from "@/app/(app)/actions";
import { listEventRelationshipChoices } from "@/lib/repositories/events";
import { NoteEventRelation } from "@/components/notes/NoteEventRelation";

export const metadata = { title: "LifeOS — Notes" };

async function removeNote(noteId: string) {
  "use server";
  await deleteNoteAction(noteId);
}

/** Saved quick notes belong here immediately; no hidden capture dead-end. */
export default async function NotesPage() {
  const userId = await requireUserId();
  const [notes, choices] = await Promise.all([db.note.findMany({
    where: { userId },
    select: { id: true, title: true, content: true, updatedAt: true, event: { select: { id: true, title: true, kind: true, startAt: true, allDay: true } } },
    orderBy: { updatedAt: "desc" },
  }), listEventRelationshipChoices(userId)]);

  return (
    <>
      <header className="topbar">
        <div><p className="eyebrow">CAPTURED THOUGHTS</p><h1>Notes</h1></div>
      </header>
      {notes.length === 0 ? (
        <div className="notes-empty"><FileText size={20} /><p>Your quick notes will appear here.</p></div>
      ) : (
        <div className="notes-list">
          {notes.map((note) => (
            <article className="note-card" key={note.id}>
              <FileText size={18} />
              <div>
                <h2>{note.title}</h2>
                <p>{note.content}</p>
                <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(note.updatedAt)}</time>
                <NoteEventRelation noteId={note.id} event={note.event ? { ...note.event, startAt: note.event.startAt.toISOString() } : null} choices={choices.map((event) => ({ ...event, startAt: event.startAt.toISOString() }))} />
              </div>
              <form action={removeNote.bind(null, note.id)}>
                <button className="note-delete" type="submit" aria-label={`Delete ${note.title}`} title="Delete note"><Trash2 size={16} /></button>
              </form>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
