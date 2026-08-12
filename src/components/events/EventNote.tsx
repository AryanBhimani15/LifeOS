"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Quote } from "lucide-react";
import { updateEventDetailAction } from "@/app/(app)/events/actions";

/**
 * The "important details" note on an event.
 *
 * This is the thing someone writes down after a lecturer says "the exam is
 * mostly normalization" — the single most valuable piece of information
 * attached to an exam, and the reason the event page exists at all.
 *
 * With no note it is one line offering to add one. It is never an empty panel
 * with a heading and nothing under it.
 */
export function EventNote({
  eventId,
  description,
}: {
  eventId: string;
  description: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description ?? "");
  const [pending, startTransition] = useTransition();

  const save = () => {
    const next = text.trim();
    if (next === (description ?? "")) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await updateEventDetailAction(eventId, { description: next || null });
      setEditing(false);
      router.refresh();
    });
  };

  if (!description && !editing) {
    return (
      <button type="button" className="event-add-note" onClick={() => setEditing(true)}>
        <Plus size={14} /> Add important details
      </button>
    );
  }

  return (
    <section className="event-block">
      <div className="event-block-head">
        <h2>Important details</h2>
        {pending && <Loader2 size={14} className="spin" />}
      </div>

      {editing ? (
        <textarea
          className="event-note-edit"
          value={text}
          autoFocus
          rows={4}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText(description ?? "");
              setEditing(false);
            }
          }}
          placeholder="What did the teacher say?"
        />
      ) : (
        <button type="button" className="event-note" onClick={() => setEditing(true)}>
          <Quote size={14} />
          <span>{description}</span>
        </button>
      )}
    </section>
  );
}
