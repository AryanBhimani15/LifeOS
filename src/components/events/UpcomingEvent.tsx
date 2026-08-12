import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";

/**
 * The next thing that is *happening*, as opposed to the next thing that is due.
 *
 * That distinction is the reason this is a separate card from the task list. An
 * exam at 10:00 is not "due at 10:00" — it runs between two times, and saying
 * "Due 10:00 AM" about it is simply wrong. So this reads "Tomorrow · 10:00 AM –
 * 11:30 AM", and the task list keeps "Due".
 */

export interface UpcomingEventData {
  id: string;
  title: string;
  kind: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
}

const KIND_LABEL: Record<string, string> = {
  EXAM: "Exam",
  CLASS: "Class",
  MEETING: "Meeting",
  DEADLINE: "Deadline",
  EVENT: "Event",
};

/** "Tomorrow", "Today", or a short date. */
export function dayLabel(date: Date, now = new Date()): string {
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (sameDay(date, now)) return "Today";
  if (sameDay(date, tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    date,
  );
}

export function timeRange(startAt: Date, endAt: Date, allDay: boolean): string {
  if (allDay) return "All day";
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmt.format(startAt)} – ${fmt.format(endAt)}`;
}

/** Whole days between now and the event, floored — "1 day left" on the eve. */
export function daysLeft(startAt: Date, now = new Date()): number {
  const start = new Date(startAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((start.getTime() - today.getTime()) / 86_400_000);
}

export function UpcomingEvent({ event }: { event: UpcomingEventData }) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const left = daysLeft(start);

  return (
    <Link className="upcoming" href={`/events/${event.id}`}>
      <span className="upcoming-icon">
        <CalendarDays size={17} />
      </span>

      <span className="upcoming-copy">
        <span className="upcoming-kind">Next {KIND_LABEL[event.kind]?.toLowerCase() ?? "event"}</span>
        <b>{event.title}</b>
        <small>
          {dayLabel(start)} · {timeRange(start, end, event.allDay)}
          {event.location && (
            <>
              {" · "}
              <MapPin size={11} /> {event.location}
            </>
          )}
        </small>
      </span>

      <span className="upcoming-left">
        {left <= 0 ? "Today" : `${left} day${left === 1 ? "" : "s"} left`}
      </span>
    </Link>
  );
}
