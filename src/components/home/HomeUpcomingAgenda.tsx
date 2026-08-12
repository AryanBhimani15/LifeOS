import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { addDays, groupByDay, WEEKDAY_SHORT, type CalendarItem } from "@/lib/calendar";

/**
 * Week at a glance — the same data the Calendar page draws.
 *
 * It used to query events alone, which meant a week full of deadlines and exams
 * could look completely clear here and completely full one click away. It now
 * takes `CalendarItem`s from the same repository, so the two can only ever
 * agree.
 */
export function HomeUpcomingAgenda({
  items,
  today,
}: {
  items: CalendarItem[];
  today: string;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const byDay = groupByDay(items);
  const total = days.reduce((sum, day) => sum + (byDay.get(day)?.length ?? 0), 0);

  return (
    <section className="home-upcoming-agenda" aria-labelledby="week-ahead-heading">
      <header>
        <div>
          <span>
            <CalendarDays size={15} /> Week at a glance
          </span>
          <h2 id="week-ahead-heading">Your calendar, next 7 days</h2>
        </div>
        <Link href="/calendar">
          Calendar <ChevronRight size={14} />
        </Link>
      </header>

      <div className="home-calendar-preview" aria-label="Seven day calendar preview">
        {days.map((day, index) => {
          const dayItems = byDay.get(day) ?? [];
          return (
            <div className={index === 0 ? "is-today" : ""} key={day}>
              <span>
                {index === 0 ? "Today" : WEEKDAY_SHORT[new Date(`${day}T00:00:00Z`).getUTCDay()]}
              </span>
              <b>{Number(day.slice(8, 10))}</b>
              {dayItems.slice(0, 2).map((item) =>
                item.href ? (
                  <Link
                    href={item.href}
                    key={item.key}
                    title={item.title}
                    className={`is-${item.kind}`}
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span key={item.key} title={item.title} className={`is-${item.kind}`}>
                    {item.title}
                  </span>
                ),
              )}
              {dayItems.length > 2 && <small>+{dayItems.length - 2} more</small>}
            </div>
          );
        })}
      </div>

      <p className="home-calendar-foot">
        {total
          ? `${total} scheduled item${total === 1 ? "" : "s"} this week.`
          : "A clear week ahead — nothing scheduled yet."}
      </p>
    </section>
  );
}
