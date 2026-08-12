import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";

type Upcoming = {
  id: string;
  title: string;
  kind: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
};

function dayKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/** A real seven-day calendar preview, replacing the old decorative progress graph. */
export function HomeUpcomingAgenda({ events }: { events: Upcoming[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() + index);
    return date;
  });
  const eventsByDay = new Map<string, Upcoming[]>();
  for (const event of events) {
    const key = dayKey(new Date(event.startAt));
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }
  const thisWeekCount = events.filter((event) => new Date(event.startAt) < new Date(today.getTime() + 7 * 86_400_000)).length;

  return (
    <section className="home-upcoming-agenda" aria-labelledby="week-ahead-heading">
      <header>
        <div>
          <span><CalendarDays size={15} /> Week at a glance</span>
          <h2 id="week-ahead-heading">Your calendar, next 7 days</h2>
        </div>
        <Link href="/calendar">Calendar <ChevronRight size={14} /></Link>
      </header>

      <div className="home-calendar-preview" aria-label="Seven day calendar preview">
        {days.map((date, index) => {
          const dayEvents = eventsByDay.get(dayKey(date)) ?? [];
          return (
            <div className={index === 0 ? "is-today" : ""} key={date.toISOString()}>
              <span>{index === 0 ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)}</span>
              <b>{date.getDate()}</b>
              {dayEvents.slice(0, 2).map((event) => <Link href={`/events/${event.id}`} key={event.id} title={event.title} className={event.kind.toLowerCase()}>{event.title}</Link>)}
              {dayEvents.length > 2 && <small>+{dayEvents.length - 2} more</small>}
            </div>
          );
        })}
      </div>
      <p className="home-calendar-foot">{thisWeekCount ? `${thisWeekCount} scheduled item${thisWeekCount === 1 ? "" : "s"} this week.` : "A clear week ahead — nothing scheduled yet."}</p>
    </section>
  );
}
