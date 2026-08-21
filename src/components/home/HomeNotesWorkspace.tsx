"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronLeft, FileText, Loader2, Mic, Plus, Search, Tag, Trash2 } from "lucide-react";
import { addQuickNoteAction, deleteNoteAction } from "@/app/(app)/actions";
import { useToast } from "@/components/ToastProvider";
import { HomeHabits, type HomeHabit } from "@/components/home/HomeHabits";

export type HomeNote = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  updatedAt: string;
};
type Filter = "all" | "pinned";

/**
 * Home owns the fast-capture composer and the compact note reader.  Neither
 * surface navigates away: Quick note is for rapid capture; Notes is for
 * browsing the notes already saved to the account.
 */
export function HomeNotesWorkspace({ notes, habits, today }: { notes: HomeNote[]; habits: HomeHabit[]; today: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visibleNotes = filter === "pinned" ? notes.filter((note) => note.pinned) : notes;
  const selected = notes.find((note) => note.id === selectedId) ?? visibleNotes[0] ?? notes[0] ?? null;

  const focusComposer = useCallback(() => {
    setQuickOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  useEffect(() => {
    window.addEventListener("lifeos:focus-home-quick-note", focusComposer);
    return () => window.removeEventListener("lifeos:focus-home-quick-note", focusComposer);
  }, [focusComposer]);

  function save() {
    startTransition(async () => {
      const result = await addQuickNoteAction(draft);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setDraft("");
      toast("Quick note saved.");
      // The server page refetches the index and keeps the reader in place.
      router.refresh();
    });
  }

  function removeNote() {
    if (!selected || pending) return;
    startTransition(async () => {
      const result = await deleteNoteAction(selected.id);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setSelectedId(null);
      toast("Note deleted.");
      router.refresh();
    });
  }

  return (
    <aside className="home-notes" aria-label="Quick notes and notes">
      <button type="button" className="home-quick-note-tab" onClick={() => setQuickOpen((open) => !open)} aria-expanded={quickOpen}>
        <CheckSquare size={18} /> Quick note {quickOpen ? <ChevronLeft size={16} /> : <Plus size={16} />}
      </button>
      <section className={`home-quick-note-panel ${quickOpen ? "is-open" : ""}`} aria-hidden={!quickOpen}>
        <header className="home-quick-note">
          <span><CheckSquare size={22} /></span>
          <div><h2>Quick note</h2><p>Jot down anything.</p></div>
        </header>
        <textarea
          ref={textareaRef}
          className="home-quick-note-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What’s on your mind?"
          aria-label="Write a quick note"
        />
        <div className="home-quick-note-tools">
          <span><Tag size={16} /> Add tags</span>
          <span title="Voice capture will be available soon"><Mic size={16} /> Add to voice</span>
        </div>
        <button type="button" className="home-quick-note-save" disabled={pending || !draft.trim()} onClick={save}>
          {pending ? <Loader2 size={17} className="spin" /> : "Save note"}
        </button>
      </section>

      <section className="home-notes-card">
        <header>
          <div><FileText size={19} /><h2>Notes</h2></div>
          <Search size={18} aria-hidden="true" />
        </header>
        <nav aria-label="Note filters">
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All notes</button>
          <button type="button" className={filter === "pinned" ? "is-active" : ""} onClick={() => setFilter("pinned")}>Pinned</button>
          <button type="button" onClick={focusComposer}>Tags</button>
          <button type="button" className="home-note-add" onClick={focusComposer} aria-label="Write a quick note"><Plus size={17} /></button>
        </nav>
        <div className="home-note-grid">
          <div className="home-note-index">
            {visibleNotes.length ? visibleNotes.map((note) => (
              <button
                type="button"
                key={note.id}
                className={note.id === selected?.id ? "is-active" : ""}
                onClick={() => setSelectedId(note.id)}
              >
                <b>{note.title}</b>
                <small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(note.updatedAt))}</small>
              </button>
            )) : <p>No notes yet.</p>}
          </div>
          <article className="home-note-preview" aria-live="polite">
            {selected ? <><div className="home-note-preview-head"><small>Saved note</small><button type="button" onClick={removeNote} disabled={pending} aria-label={`Delete ${selected.title}`} title="Delete note"><Trash2 size={15} /></button></div><h3>{selected.title}</h3><p>{selected.content}</p></> : <><small>Notes</small><h3>Your notes live here.</h3><p>Use Quick note above to save the first one without leaving Home.</p></>}
          </article>
        </div>
      </section>
      <HomeHabits habits={habits} today={today} />
    </aside>
  );
}

/** The pink Note action under the Home capture field opens the Home composer. */
export function FocusQuickNoteButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("lifeos:focus-home-quick-note"))}>
      <FileText size={14} /> Note
    </button>
  );
}
