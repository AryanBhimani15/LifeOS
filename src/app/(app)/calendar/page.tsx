import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUserId } from "@/lib/session";
import {
  calendarItems,
  calendarSettings,
  isDefaultKinds,
  parseKinds,
} from "@/lib/repositories/calendar";
import { calendarQuerySchema } from "@/lib/validation/calendar";
import {
  CALENDAR_KINDS,
  KIND_LABEL,
  rangeFor,
  startOfMonth,
  step,
  viewTitle,
  type CalendarView,
} from "@/lib/calendar";
import { CalendarShell } from "@/components/calendar/CalendarShell";
import { NewEventSheet } from "@/components/calendar/NewEventSheet";

export const metadata = { title: "LifeOS — Calendar" };

/**
 * The calendar: one timeline over everything LifeOS already knows.
 *
 * View, date and filters all live in the URL. That is what makes "next month
 * with only exams showing" a link someone can bookmark, and what makes the page
 * survive the refresh that follows moving something.
 */

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const parsed = calendarQuerySchema.safeParse(params).data ?? { view: "month" as const };

  const { zone, weekStartsOn, today } = await calendarSettings(userId);
  const view = parsed.view;
  // The month view is anchored on the first of the month so paging is stable —
  // stepping from the 31st must not skip February.
  const anchor = view === "month"
    ? startOfMonth(parsed.date ?? today)
    : (parsed.date ?? today);

  const kinds = parseKinds(typeof params.kinds === "string" ? params.kinds : undefined);
  const range = rangeFor(view, anchor, weekStartsOn);
  const items = await calendarItems(userId, { ...range, kinds });

  const link = (patch: { view?: CalendarView; date?: string; kinds?: string }) => {
    const next = new URLSearchParams();
    next.set("view", patch.view ?? view);
    next.set("date", patch.date ?? anchor);
    // The default selection is left out of the URL entirely, so a plain
    // /calendar link keeps meaning "the sensible default" rather than freezing
    // whatever the defaults happened to be the day the link was made.
    const kindParam = patch.kinds ?? (isDefaultKinds(kinds) ? "" : kinds.join(","));
    if (kindParam) next.set("kinds", kindParam);
    return `/calendar?${next.toString()}`;
  };

  /** Toggling a filter chip adds or removes that kind from the URL. */
  const toggleKind = (kind: (typeof CALENDAR_KINDS)[number]) => {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    // Turning the last one off would show an empty calendar, which reads as a
    // bug rather than a choice, so the click is simply ignored.
    if (next.length === 0) return link({});
    return link({ kinds: isDefaultKinds(next) ? "" : next.join(",") });
  };

  return (
    <>
      <header className="topbar goals-topbar">
        <div>
          <p className="eyebrow">EVERYTHING, IN ORDER</p>
          <h1>Calendar</h1>
          <p className="goals-subtitle">
            Your tasks, exams, events, goals and workouts on one timeline.
          </p>
        </div>
        <NewEventSheet defaultDate={view === "month" ? today : anchor} />
      </header>

      <section className="calendar-controls">
        <div className="calendar-nav">
          <Link href={link({ date: today })} className="calendar-today">
            Today
          </Link>
          <Link
            href={link({ date: step(view, anchor, -1) })}
            className="calendar-step"
            aria-label="Previous"
          >
            <ChevronLeft size={16} />
          </Link>
          <Link
            href={link({ date: step(view, anchor, 1) })}
            className="calendar-step"
            aria-label="Next"
          >
            <ChevronRight size={16} />
          </Link>
          <h2>{viewTitle(view, anchor, weekStartsOn)}</h2>
        </div>

        <nav className="calendar-views" aria-label="Calendar view">
          {VIEWS.map((option) => (
            <Link
              key={option.value}
              href={link({ view: option.value })}
              className={view === option.value ? "is-active" : ""}
              aria-current={view === option.value ? "page" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </section>

      <section className="calendar-filters" aria-label="Filter what is shown">
        {CALENDAR_KINDS.map((kind) => {
          const on = kinds.includes(kind);
          return (
            <Link
              key={kind}
              href={toggleKind(kind)}
              className={`calendar-chip is-${kind} ${on ? "is-on" : ""}`}
              aria-pressed={on}
            >
              <i /> {KIND_LABEL[kind]}
            </Link>
          );
        })}
      </section>

      <CalendarShell
        items={items}
        view={view}
        anchor={anchor}
        today={today}
        weekStartsOn={weekStartsOn}
        timeZone={zone}
      />
    </>
  );
}
