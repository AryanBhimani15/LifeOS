"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ExternalLink, Loader2, X } from "lucide-react";
import { rescheduleAction } from "@/app/(app)/calendar/actions";
import { useToast } from "@/components/ToastProvider";
import {
  addDays,
  compareItems,
  dayCells,
  dayTitle,
  groupByDay,
  monthGridRange,
  rangeFor,
  timeRangeLabel,
  weekdayHeadings,
  type CalendarItem,
  type CalendarView,
} from "@/lib/calendar";

/**
 * The calendar surface: four views over one already-fetched set of items.
 *
 * The server sends every item in the visible range, so switching between month,
 * week, day and agenda — and opening a day's panel — costs nothing and never
 * flashes a loading state. Only paging to a different range is a navigation.
 */

const MAX_PILLS = 3;

export function CalendarShell({
  items,
  view,
  anchor,
  today,
  weekStartsOn,
  timeZone,
}: {
  items: CalendarItem[];
  view: CalendarView;
  anchor: string;
  today: string;
  weekStartsOn: number;
  timeZone: string;
}) {
  const [selected, setSelected] = useState<string | null>(view === "day" ? anchor : null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const byDay = useMemo(() => groupByDay(items), [items]);
  const dayItems = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div className={`calendar-body ${selected ? "has-panel" : ""}`}>
      <div className="calendar-canvas">
        {view === "month" && (
          <MonthGrid
            byDay={byDay}
            anchor={anchor}
            today={today}
            weekStartsOn={weekStartsOn}
            selected={selected}
            expanded={expanded}
            onSelect={setSelected}
            onExpand={setExpanded}
            timeZone={timeZone}
          />
        )}
        {view === "week" && (
          <WeekView
            byDay={byDay}
            anchor={anchor}
            today={today}
            weekStartsOn={weekStartsOn}
            selected={selected}
            onSelect={setSelected}
            timeZone={timeZone}
          />
        )}
        {view === "day" && <DayView items={byDay.get(anchor) ?? []} day={anchor} timeZone={timeZone} />}
        {view === "agenda" && (
          <AgendaView byDay={byDay} anchor={anchor} today={today} timeZone={timeZone} />
        )}
      </div>

      {selected && view !== "day" && (
        <DayPanel
          day={selected}
          items={dayItems}
          today={today}
          timeZone={timeZone}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

function MonthGrid({
  byDay,
  anchor,
  today,
  weekStartsOn,
  selected,
  expanded,
  onSelect,
  onExpand,
  timeZone,
}: {
  byDay: Map<string, CalendarItem[]>;
  anchor: string;
  today: string;
  weekStartsOn: number;
  selected: string | null;
  expanded: string | null;
  onSelect: (day: string) => void;
  onExpand: (day: string | null) => void;
  timeZone: string;
}) {
  const { from } = monthGridRange(anchor, weekStartsOn);
  const days = dayCells(from, 42);
  const month = anchor.slice(0, 7);

  return (
    <div className="calendar-month">
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdayHeadings(weekStartsOn).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const isOpen = expanded === day;
          const shown = isOpen ? items : items.slice(0, MAX_PILLS);
          const hidden = items.length - shown.length;

          return (
            <div
              key={day}
              className={[
                "calendar-cell",
                day.slice(0, 7) === month ? "" : "is-outside",
                day === today ? "is-today" : "",
                day === selected ? "is-selected" : "",
              ].filter(Boolean).join(" ")}
            >
              <button
                type="button"
                className="calendar-daynum"
                onClick={() => onSelect(day)}
                aria-label={`${dayTitle(day)}, ${items.length} item${items.length === 1 ? "" : "s"}`}
              >
                {Number(day.slice(8, 10))}
              </button>

              <div className="calendar-pills">
                {shown.map((item) => (
                  <Pill key={item.key} item={item} timeZone={timeZone} />
                ))}
                {hidden > 0 && (
                  <button type="button" className="calendar-more" onClick={() => onExpand(day)}>
                    +{hidden} more
                  </button>
                )}
                {isOpen && (
                  <button type="button" className="calendar-more" onClick={() => onExpand(null)}>
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const time = item.allDay ? null : timeRangeLabel(item.startAt, null, false, timeZone);
  const body = (
    <>
      {time && <em>{time}</em>}
      <span>{item.title}</span>
    </>
  );
  const className = `calendar-pill is-${item.kind} ${item.done ? "is-done" : ""}`;

  return item.href ? (
    <Link href={item.href} className={className} title={item.title}>
      {body}
    </Link>
  ) : (
    <span className={className} title={item.title}>
      {body}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

function WeekView({
  byDay,
  anchor,
  today,
  weekStartsOn,
  selected,
  onSelect,
  timeZone,
}: {
  byDay: Map<string, CalendarItem[]>;
  anchor: string;
  today: string;
  weekStartsOn: number;
  selected: string | null;
  onSelect: (day: string) => void;
  timeZone: string;
}) {
  const { from } = rangeFor("week", anchor, weekStartsOn);
  const days = dayCells(from, 7);

  return (
    <div className="calendar-week">
      {days.map((day) => {
        const items = byDay.get(day) ?? [];
        return (
          <div
            key={day}
            className={[
              "calendar-weekday",
              day === today ? "is-today" : "",
              day === selected ? "is-selected" : "",
            ].filter(Boolean).join(" ")}
          >
            <button type="button" onClick={() => onSelect(day)} className="calendar-weekday-head">
              <span>{weekdayHeadings(weekStartsOn)[days.indexOf(day)]}</span>
              <b>{Number(day.slice(8, 10))}</b>
            </button>
            <div className="calendar-pills">
              {items.map((item) => (
                <Pill key={item.key} item={item} timeZone={timeZone} />
              ))}
              {items.length === 0 && <p className="calendar-day-clear">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day and agenda
// ---------------------------------------------------------------------------

function DayView({
  items,
  day,
  timeZone,
}: {
  items: CalendarItem[];
  day: string;
  timeZone: string;
}) {
  return (
    <div className="calendar-single-day">
      <h2>{dayTitle(day)}</h2>
      {items.length === 0 ? (
        <p className="calendar-empty">Nothing scheduled. A clear day is a result too.</p>
      ) : (
        <ItemRows items={items} timeZone={timeZone} />
      )}
    </div>
  );
}

function AgendaView({
  byDay,
  anchor,
  today,
  timeZone,
}: {
  byDay: Map<string, CalendarItem[]>;
  anchor: string;
  today: string;
  timeZone: string;
}) {
  const days = dayCells(anchor, 30).filter((day) => (byDay.get(day)?.length ?? 0) > 0);

  if (days.length === 0) {
    return <p className="calendar-empty">Nothing in the next 30 days.</p>;
  }

  return (
    <div className="calendar-agenda">
      {days.map((day) => (
        <section key={day}>
          <h3>
            {dayTitle(day)}
            {day === today && <em>Today</em>}
          </h3>
          <ItemRows items={byDay.get(day) ?? []} timeZone={timeZone} />
        </section>
      ))}
    </div>
  );
}

function ItemRows({ items, timeZone }: { items: CalendarItem[]; timeZone: string }) {
  return (
    <ul className="calendar-rows">
      {[...items].sort(compareItems).map((item) => {
        const time = timeRangeLabel(item.startAt, item.endAt, item.allDay, timeZone);
        const inner = (
          <>
            <span className="calendar-row-time">{time}</span>
            <i className={`calendar-dot is-${item.kind}`} />
            <span className="calendar-row-title">
              {item.title}
              {item.detail && <em>{item.detail}</em>}
            </span>
            {item.done && <Check size={14} className="calendar-row-done" />}
          </>
        );
        return (
          <li key={item.key} className={item.done ? "is-done" : ""}>
            {item.href ? <Link href={item.href}>{inner}</Link> : <div>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Day panel
// ---------------------------------------------------------------------------

function DayPanel({
  day,
  items,
  today,
  timeZone,
  onClose,
}: {
  day: string;
  items: CalendarItem[];
  today: string;
  timeZone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState<string | null>(null);

  function move(item: CalendarItem, to: string) {
    if (!to || to === day) {
      setMoving(null);
      return;
    }
    startTransition(async () => {
      const result = await rescheduleAction({ kind: item.kind, sourceId: item.sourceId, day: to });
      if (result.error) {
        toast(result.error, "error");
        return;
      }
      setMoving(null);
      toast(`"${item.title}" moved to ${dayTitle(to)}.`);
      router.refresh();
    });
  }

  return (
    <aside className="calendar-panel" aria-label={`Agenda for ${dayTitle(day)}`}>
      <header>
        <div>
          <span>{day === today ? "TODAY" : "AGENDA"}</span>
          <h2>{dayTitle(day)}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the day panel">
          <X size={16} />
        </button>
      </header>

      {items.length === 0 ? (
        <p className="calendar-empty">
          <CalendarDays size={18} />
          Nothing scheduled for this day.
        </p>
      ) : (
        <ul className="calendar-panel-list">
          {[...items].sort(compareItems).map((item) => (
            <li key={item.key} className={item.done ? "is-done" : ""}>
              <div className="calendar-panel-item">
                <i className={`calendar-dot is-${item.kind}`} />
                <div>
                  <b>{item.title}</b>
                  <small>
                    {timeRangeLabel(item.startAt, item.endAt, item.allDay, timeZone)}
                    {item.detail && ` · ${item.detail}`}
                  </small>
                </div>
                {item.href && (
                  <Link href={item.href} aria-label={`Open ${item.title}`}>
                    <ExternalLink size={13} />
                  </Link>
                )}
              </div>

              {item.movable && (
                moving === item.key ? (
                  <div className="calendar-move">
                    <input
                      type="date"
                      defaultValue={day}
                      autoFocus
                      disabled={pending}
                      onChange={(event) => move(item, event.target.value)}
                      aria-label={`Move ${item.title} to another day`}
                    />
                    {pending ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <button type="button" onClick={() => setMoving(null)}>
                        Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="calendar-move-open"
                    onClick={() => setMoving(item.key)}
                  >
                    Move
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="calendar-panel-foot">
        Moving something here edits the original — the task, the exam, the goal. Nothing is copied.
      </p>
    </aside>
  );
}

export { addDays };
