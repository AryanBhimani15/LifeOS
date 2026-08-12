import { FileText, Trash2 } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { deleteNoteAction } from "@/app/(app)/actions";

export const metadata = { title: "LifeOS — Notes" };

async function removeNote(noteId: string) {
  "use server";
  await deleteNoteAction(noteId);
}

/** Saved quick notes belong here immediately; no hidden capture dead-end. */
export default async function NotesPage() {
  const userId = await requireUserId();
  const notes = await db.note.findMany({
    where: { userId },
    select: { id: true, title: true, content: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

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
