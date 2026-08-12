"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { createCalendarEventAction } from "@/app/(app)/calendar/actions";
import { useToast } from "@/components/ToastProvider";

/**
 * Adding an event — and only an event.
 *
 * Tasks and habits are conspicuously absent. Both already have a front door
 * with its own rules (a task goes through the capture parser; a habit needs a
 * schedule), and a second one here would be a worse copy of each.
 */

const REMINDERS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At the time" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

export function NewEventSheet({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    title: "",
    date: defaultDate,
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    notes: "",
    remind: "",
  });
  const [allDay, setAllDay] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const title = form.title.trim();
    if (!title) {
      setError("An event needs a title.");
      return;
    }

    startTransition(async () => {
      const result = await createCalendarEventAction({
        title,
        date: form.date,
        allDay,
        startTime: allDay ? undefined : form.startTime,
        endTime: allDay ? undefined : form.endTime,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
        remindMinutesBefore: form.remind === "" ? null : Number(form.remind),
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      toast(`"${title}" added to your calendar.`);
      close();
      setForm((prev) => ({ ...prev, title: "", location: "", notes: "" }));
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="goal-new-button" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add event
      </button>

      {open && (
        <div className="goal-sheet-backdrop" onMouseDown={close}>
          <aside
            className="goal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="New event"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>New event</h2>
                <p>Something that happens between two times.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close">
                <X size={17} />
              </button>
            </header>

            <form onSubmit={submit}>
              <label className="goal-field">
                <span>Title</span>
                <input
                  ref={firstField}
                  value={form.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder="Project review with the guide"
                  maxLength={200}
                  required
                />
              </label>

              <div className="goal-field-row">
                <label className="goal-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(event) => set("date", event.target.value)}
                    required
                  />
                </label>
                <label className="goal-field">
                  <span>Location <em>optional</em></span>
                  <input
                    value={form.location}
                    onChange={(event) => set("location", event.target.value)}
                    placeholder="Room 304"
                    maxLength={200}
                  />
                </label>
              </div>

              <label className="calendar-allday">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
                <span>All day</span>
              </label>

              {!allDay && (
                <div className="goal-field-row">
                  <label className="goal-field">
                    <span>Starts</span>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(event) => set("startTime", event.target.value)}
                      required
                    />
                  </label>
                  <label className="goal-field">
                    <span>Ends</span>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(event) => set("endTime", event.target.value)}
                    />
                  </label>
                </div>
              )}

              <label className="goal-field">
                <span>Reminder</span>
                <select value={form.remind} onChange={(event) => set("remind", event.target.value)}>
                  {REMINDERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="goal-field">
                <span>Notes <em>optional</em></span>
                <textarea
                  value={form.notes}
                  onChange={(event) => set("notes", event.target.value)}
                  rows={3}
                  maxLength={10000}
                  placeholder="What needs to be ready beforehand?"
                />
              </label>

              {error && (
                <p className="goal-form-error" role="alert">
                  {error}
                </p>
              )}

              <footer>
                <button type="button" onClick={close} className="goal-secondary-button">
                  Cancel
                </button>
                <button type="submit" className="goal-primary-button" disabled={pending}>
                  {pending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                  {pending ? "Adding…" : "Add event"}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
