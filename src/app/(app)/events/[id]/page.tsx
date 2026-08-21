import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ArrowLeft, CalendarDays, Clock, MapPin } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { getEvent, listTaskRelationshipChoices, listUnrelatedNoteChoices } from "@/lib/repositories/events";
import { AppError } from "@/lib/errors";
import { Attachments } from "@/components/events/Attachments";
import { PrepTasks } from "@/components/events/PrepTasks";
import { dayLabel, daysLeft, timeRange } from "@/components/events/UpcomingEvent";
import { EventNote } from "@/components/events/EventNote";
import { EventRelatedNotes } from "@/components/events/EventRelatedNotes";
import { EventReminder } from "@/components/events/EventReminder";

export const metadata = { title: "LifeOS — Event" };

const KIND_LABEL: Record<string, string> = {
  EXAM: "Exam",
  CLASS: "Class",
  MEETING: "Meeting",
  DEADLINE: "Deadline",
  EVENT: "Event",
};

/**
 * The page for one event — an exam, a class, a meeting.
 *
 * Built to grow. An event with nothing but a title and a time renders as a
 * title and a time; there is no empty "Notes" panel, no zero-count attachment
 * box, no placeholder anywhere. Every section either has content or collapses
 * to a single line offering to add some.
 *
 * That is the difference between this and the task detail sheet: a task is a
 * line of text with a date, and an event is a place where notes, preparation
 * and files accumulate around something that is going to happen.
 */
export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  let event;
  try {
    event = await getEvent(userId, id);
  } catch (error) {
    // A missing event is a 404 page, not a 500.
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const start = event.startAt;
  const end = event.endAt;
  const left = daysLeft(start);
  const kind = KIND_LABEL[event.kind] ?? "Event";
  const [availableTasks, availableNotes] = await Promise.all([
    listTaskRelationshipChoices(userId),
    listUnrelatedNoteChoices(userId),
  ]);

  return (
    <>
      <header className="event-top">
        <Link className="event-back" href="/today" aria-label="Back">
          <ArrowLeft size={16} />
        </Link>
      </header>

      <div className="event-layout">
        <div className="event-main">
          <div className="event-head">
            <span className="event-head-icon">
              <CalendarDays size={22} />
            </span>
            <div>
              <h1>{event.title}</h1>
              <p className="event-head-meta">
                <span className={`event-kind is-${event.kind.toLowerCase()}`}>{kind}</span>
                {dayLabel(start)} · {timeRange(start, end, event.allDay)}
              </p>
            </div>
          </div>

          {/* Important details — only when there are any. */}
          <EventNote eventId={event.id} description={event.description} />

          <PrepTasks
            eventId={event.id}
            tasks={event.prepTasks.map((task) => ({
              ...task,
              dueAt: task.dueAt?.toISOString() ?? null,
            }))}
            availableTasks={availableTasks.map((task) => ({ ...task, dueAt: task.dueAt?.toISOString() ?? null }))}
          />
          <EventRelatedNotes
            eventId={event.id}
            notes={event.notes.map((note) => ({ ...note, updatedAt: note.updatedAt.toISOString() }))}
            availableNotes={availableNotes.map((note) => ({ ...note, updatedAt: note.updatedAt.toISOString() }))}
          />
        </div>

        <aside className="event-rail">
          <EventReminder eventId={event.id} reminder={event.reminders[0] ? { ...event.reminders[0], remindAt: event.reminders[0].remindAt.toISOString() } : null} />

          <section className="rail-card">
            <div className="rail-head">
              <h3>When &amp; where</h3>
              {left >= 0 && (
                <span className="rail-count">
                  {left === 0 ? "Today" : `${left} day${left === 1 ? "" : "s"} left`}
                </span>
              )}
            </div>

            <ul className="rail-facts">
              <li>
                <CalendarDays size={14} />
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(start)}
                <em>({dayLabel(start)})</em>
              </li>
              <li>
                <Clock size={14} />
                {timeRange(start, end, event.allDay)}
              </li>
              {/* Location is optional and simply absent when unset. */}
              {event.location && (
                <li>
                  <MapPin size={14} />
                  {event.location}
                </li>
              )}
            </ul>
          </section>

          {(event.tags.length > 0 || event.documents.length > 0) && <section className="rail-card">
            {event.tags.length > 0 && (
              <div className="event-tags">
                <div className="rail-head"><h3>Tags</h3></div>
                <div className="event-tag-list">
                  {event.tags.map(({ tag }) => <span key={tag.id} style={{ "--tag-color": tag.color } as CSSProperties}>{tag.name}</span>)}
                </div>
              </div>
            )}
            <Attachments
              uploadUrl={`/api/events/${encodeURIComponent(event.id)}/attachments`}
              attachments={event.documents.map((doc) => ({
                ...doc,
                createdAt: doc.createdAt.toISOString(),
              }))}
            />
          </section>}
          {event.documents.length === 0 && <section className="event-resource-empty"><Attachments uploadUrl={`/api/events/${encodeURIComponent(event.id)}/attachments`} attachments={[]} title="Resources" /></section>}
        </aside>
      </div>
    </>
  );
}
