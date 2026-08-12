"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckSquare, Loader2, Tag, X } from "lucide-react";
import { addQuickNoteAction } from "@/app/(app)/actions";
import { useToast } from "./ToastProvider";

/** A deliberate, distraction-free capture surface available from every page. */
export function QuickNoteOverlay() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const show = () => setOpen(true);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("lifeos:quick-note", show);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("lifeos:quick-note", show);
      window.removeEventListener("keydown", keydown);
    };
  }, []);

  function save() {
    startTransition(async () => {
      const result = await addQuickNoteAction(text);
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setText("");
      setOpen(false);
      toast("Quick note saved.");
    });
  }

  if (!open) return null;
  return (
    <div className="quick-note-overlay" role="dialog" aria-modal="true" aria-label="Quick note">
      <button className="quick-note-scrim" type="button" aria-label="Close quick note" onClick={() => setOpen(false)} />
      <aside className="quick-note-drawer">
        <div className="quick-note-heading">
          <span className="quick-note-icon"><CheckSquare size={22} /></span>
          <div><h2>Quick note</h2><p>Jot down anything.</p></div>
          <button className="quick-note-close" type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What’s on your mind?"
          autoFocus
        />
        <button type="button" className="quick-note-tags"><Tag size={16} /> Add tags</button>
        <button type="button" className="quick-note-save" disabled={pending || !text.trim()} onClick={save}>
          {pending ? <Loader2 className="spin" size={17} /> : "Save note"}
        </button>
      </aside>
    </div>
  );
}
