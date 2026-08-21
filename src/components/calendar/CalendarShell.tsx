"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ExternalLink, Loader2, X } from "lucide-react";
import { rescheduleAction } from "@/app/(app)/calendar/actions";
import { useToast } from "@/components/ToastProvider";
import {
  compareItems,
  dayCells,
  dayTitle,
  groupByDay,
  layoutTimedItems,
  monthGridRange,
  rangeFor,
  scheduleLoad,
  timeLabel,
  timeRangeLabel,
  weekdayHeadings,
  type CalendarItem,
  type CalendarView,
} from "@/lib/calendar";

/** Four responsive projections of the same server-fetched source rows. */
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
    <div className={`calendar-body ${selected && view !== "day" ? "has-panel" : ""}`}>
      <div className="calendar-canvas">
        {items.length === 0 ? (
          <CalendarEmpty view={view} />
        ) : view === "month" ? (
          <MonthGrid {...{ byDay, anchor, today, weekStartsOn, selected, expanded, timeZone }} onSelect={setSelected} onExpand={setExpanded} />
        ) : view === "week" ? (
          <WeekView {...{ byDay, anchor, today, weekStartsOn, selected, timeZone }} onSelect={setSelected} />
        ) : view === "day" ? (
          <DayView items={byDay.get(anchor) ?? []} day={anchor} timeZone={timeZone} />
        ) : (
          <AgendaView {...{ byDay, anchor, today, timeZone }} />
        )}
      </div>

      {selected && view !== "day" && (
        <DayPanel day={selected} items={dayItems} today={today} timeZone={timeZone} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function CalendarEmpty({ view }: { view: CalendarView }) {
  return (
    <div className="calendar-empty-state">
      <CalendarDays size={21} />
      <div>
        <b>{view === "agenda" ? "Nothing in this window." : "A clear calendar."}</b>
        <p>Add an event, exam, or dated task when something belongs on the timeline.</p>
      </div>
    </div>
  );
}

function MonthGrid({
  byDay, anchor, today, weekStartsOn, selected, expanded, onSelect, onExpand, timeZone,
}: {
  byDay: Map<string, CalendarItem[]>; anchor: string; today: string; weekStartsOn: number;
  selected: string | null; expanded: string | null; onSelect: (day: string) => void;
  onExpand: (day: string | null) => void; timeZone: string;
}) {
  const { from } = monthGridRange(anchor, weekStartsOn);
  const days = dayCells(from, 42);
  const month = anchor.slice(0, 7);

  return <div className="calendar-month">
    <div className="calendar-weekdays" aria-hidden="true">{weekdayHeadings(weekStartsOn).map((label) => <span key={label}>{label}</span>)}</div>
    <div className="calendar-grid">
      {days.map((day) => {
        const entries = byDay.get(day) ?? [];
        const isOpen = expanded === day;
        const shown = isOpen ? entries : entries.slice(0, MAX_PILLS);
        const hidden = entries.length - shown.length;
        const load = scheduleLoad(entries);
        return <div key={day} className={[
          "calendar-cell", day.slice(0, 7) === month ? "" : "is-outside", day === today ? "is-today" : "",
          day === selected ? "is-selected" : "", load ? `is-load-${load.label.toLowerCase().replace(" ", "-")}` : "",
        ].filter(Boolean).join(" ")}>
          <div className="calendar-cell-head">
            <button type="button" className="calendar-daynum" onClick={() => onSelect(day)} aria-label={`${dayTitle(day)}, ${entries.length} items`}>
              {Number(day.slice(8, 10))}
            </button>
            {load && <span className="calendar-load" title={`Schedule load: ${load.label}`}>{load.label}</span>}
          </div>
          <div className="calendar-pills">
            {shown.map((item) => <Pill key={item.key} item={item} timeZone={timeZone} />)}
            {hidden > 0 && <button type="button" className="calendar-more" onClick={() => onExpand(day)}>+{hidden} more</button>}
            {isOpen && entries.length > MAX_PILLS && <button type="button" className="calendar-more" onClick={() => onExpand(null)}>Show less</button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function Pill({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const meta = item.allDay
    ? item.kind === "task" ? "Due" : item.kind === "goal" ? "Goal" : null
    : timeLabel(item.startAt, timeZone);
  const body = <>{meta && <em>{meta}</em>}<span>{item.title}</span></>;
  const className = `calendar-pill is-${item.kind} ${item.done ? "is-done" : ""}`;
  return item.href ? <Link href={item.href} className={className} title={item.title}>{body}</Link> : <span className={className}>{body}</span>;
}

function WeekView({
  byDay, anchor, today, weekStartsOn, selected, onSelect, timeZone,
}: {
  byDay: Map<string, CalendarItem[]>; anchor: string; today: string; weekStartsOn: number;
  selected: string | null; onSelect: (day: string) => void; timeZone: string;
}) {
  const { from } = rangeFor("week", anchor, weekStartsOn);
  const days = dayCells(from, 7);
  const timed = days.flatMap((day) => (byDay.get(day) ?? []).filter((item) => !item.allDay));
  const bounds = timelineBounds(timed);
  return <div className="calendar-week-scroll"><div className="calendar-week-grid">
    <div className="calendar-week-corner" />
    {days.map((day, index) => <button key={day} type="button" onClick={() => onSelect(day)} className={["calendar-week-head", day === today ? "is-today" : "", day === selected ? "is-selected" : ""].filter(Boolean).join(" ")}><span>{weekdayHeadings(weekStartsOn)[index]}</span><b>{Number(day.slice(8, 10))}</b></button>)}
    <div className="calendar-allday-label">All day</div>
    {days.map((day) => <div key={`${day}-all-day`} className="calendar-week-allday">{(byDay.get(day) ?? []).filter((item) => item.allDay).map((item) => <Pill key={item.key} item={item} timeZone={timeZone} />)}</div>)}
    <TimeGutter bounds={bounds} />
    {days.map((day) => <TimelineTrack key={`${day}-track`} items={(byDay.get(day) ?? []).filter((item) => !item.allDay)} timeZone={timeZone} bounds={bounds} />)}
  </div></div>;
}

function DayView({ items, day, timeZone }: { items: CalendarItem[]; day: string; timeZone: string }) {
  const allDay = items.filter((item) => item.allDay);
  const timed = items.filter((item) => !item.allDay);
  const bounds = timelineBounds(timed);
  return <div className="calendar-single-day">
    <header><div><span>DAY TIMELINE</span><h2>{dayTitle(day)}</h2></div>{scheduleLoad(items) && <p>Schedule load · {scheduleLoad(items)?.label}</p>}</header>
    {items.length === 0 ? <CalendarEmpty view="day" /> : <>
      <section className="calendar-day-allday"><b>All-day &amp; deadlines</b><div>{allDay.length ? allDay.map((item) => <Pill key={item.key} item={item} timeZone={timeZone} />) : <span>Nothing all-day.</span>}</div></section>
      {timed.length > 0 && <div className="calendar-day-timeline"><TimeGutter bounds={bounds} /><TimelineTrack items={timed} timeZone={timeZone} bounds={bounds} /></div>}
    </>}
  </div>;
}

function AgendaView({ byDay, anchor, today, timeZone }: { byDay: Map<string, CalendarItem[]>; anchor: string; today: string; timeZone: string }) {
  const days = dayCells(anchor, 30).filter((day) => (byDay.get(day)?.length ?? 0) > 0);
  if (!days.length) return <CalendarEmpty view="agenda" />;
  return <div className="calendar-agenda">{days.map((day) => <section key={day}><h3>{agendaHeading(day, today)}<em>{day === today ? "Today" : day === dayCells(today, 2)[1] ? "Tomorrow" : dayTitle(day)}</em></h3><ItemRows items={byDay.get(day) ?? []} timeZone={timeZone} /></section>)}</div>;
}

function agendaHeading(day: string, today: string) {
  if (day === today) return "TODAY";
  if (day === dayCells(today, 2)[1]) return "TOMORROW";
  return dayTitle(day).toUpperCase();
}

function ItemRows({ items, timeZone }: { items: CalendarItem[]; timeZone: string }) {
  return <ul className="calendar-rows">{[...items].sort(compareItems).map((item) => {
    const inner = <><span className="calendar-row-time">{timeRangeLabel(item.startAt, item.endAt, item.allDay, timeZone)}</span><i className={`calendar-dot is-${item.kind}`} /><span className="calendar-row-title">{item.title}{item.detail && <em>{item.detail}</em>}</span>{item.done && <Check size={14} className="calendar-row-done" />}</>;
    return <li key={item.key} className={item.done ? "is-done" : ""}>{item.href ? <Link href={item.href}>{inner}</Link> : <div>{inner}</div>}</li>;
  })}</ul>;
}

type TimelineBounds = { start: number; end: number; height: number };
function timelineBounds(items: CalendarItem[]): TimelineBounds {
  const placements = layoutTimedItems(items);
  // An all-day-only week should not reserve a full 8 AM–8 PM blank grid. The
  // window grows for a real early/late class while keeping a recognisable
  // four-hour minimum around a short appointment.
  if (!placements.length) return { start: 8 * 60, end: 12 * 60, height: 264 };
  const earliest = Math.min(...placements.map((item) => item.start));
  const latest = Math.max(...placements.map((item) => item.end));
  const start = Math.max(0, Math.min(8 * 60, Math.floor(earliest / 60) * 60));
  const end = Math.min(24 * 60, Math.max(start + 4 * 60, Math.ceil(latest / 60) * 60));
  return { start, end, height: Math.max(264, ((end - start) / 60) * 66) };
}

function TimeGutter({ bounds }: { bounds: TimelineBounds }) {
  const hours = Array.from({ length: (bounds.end - bounds.start) / 60 + 1 }, (_, index) => bounds.start + index * 60);
  return <div className="calendar-time-gutter" style={{ height: bounds.height }}>{hours.map((minutes) => <span key={minutes} style={{ top: `${((minutes - bounds.start) / (bounds.end - bounds.start)) * 100}%` }}>{hourLabel(minutes)}</span>)}</div>;
}

function TimelineTrack({ items, timeZone, bounds }: { items: CalendarItem[]; timeZone: string; bounds: TimelineBounds }) {
  const placements = layoutTimedItems(items);
  const hours = Array.from({ length: (bounds.end - bounds.start) / 60 + 1 }, (_, index) => bounds.start + index * 60);
  return <div className="calendar-time-track" style={{ height: bounds.height }}>
    {hours.map((minutes) => <i key={minutes} className="calendar-hour-line" style={{ top: `${((minutes - bounds.start) / (bounds.end - bounds.start)) * 100}%` }} />)}
    {placements.map((placement) => {
      const visibleStart = Math.max(bounds.start, placement.start);
      const visibleEnd = Math.min(bounds.end, placement.end);
      if (visibleEnd <= visibleStart) return null;
      const style = { top: `${((visibleStart - bounds.start) / (bounds.end - bounds.start)) * 100}%`, height: `${Math.max(5, ((visibleEnd - visibleStart) / (bounds.end - bounds.start)) * 100)}%`, left: `calc(${(placement.column / placement.columns) * 100}% + 3px)`, width: `calc(${100 / placement.columns}% - 6px)` } as CSSProperties;
      const item = placement.item;
      return item.href ? <Link key={item.key} href={item.href} className={`calendar-timed-card is-${item.kind}`} style={style}><b>{item.title}</b><span>{timeRangeLabel(item.startAt, item.endAt, false, timeZone)}</span>{item.detail && <em>{item.detail}</em>}</Link> : <div key={item.key} className={`calendar-timed-card is-${item.kind}`} style={style}><b>{item.title}</b><span>{timeRangeLabel(item.startAt, item.endAt, false, timeZone)}</span></div>;
    })}
  </div>;
}

function hourLabel(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

function DayPanel({ day, items, today, timeZone, onClose }: { day: string; items: CalendarItem[]; today: string; timeZone: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState<string | null>(null);
  function move(item: CalendarItem, to: string) {
    if (!to || to === day) return setMoving(null);
    startTransition(async () => {
      const result = await rescheduleAction({ kind: item.kind, sourceId: item.sourceId, day: to });
      if (result.error) return toast(result.error, "error");
      setMoving(null); toast(`"${item.title}" moved to ${dayTitle(to)}.`); router.refresh();
    });
  }
  return <aside className="calendar-panel" aria-label={`Agenda for ${dayTitle(day)}`}><header><div><span>{day === today ? "TODAY" : "AGENDA"}</span><h2>{dayTitle(day)}</h2></div><button type="button" onClick={onClose} aria-label="Close the day panel"><X size={16} /></button></header>
    {items.length === 0 ? <p className="calendar-empty"><CalendarDays size={18} /> Nothing scheduled for this day.</p> : <ul className="calendar-panel-list">{[...items].sort(compareItems).map((item) => <li key={item.key} className={item.done ? "is-done" : ""}><div className="calendar-panel-item"><i className={`calendar-dot is-${item.kind}`} /><div><b>{item.title}</b><small>{timeRangeLabel(item.startAt, item.endAt, item.allDay, timeZone)}{item.detail && ` · ${item.detail}`}</small></div>{item.href && <Link href={item.href} aria-label={`Open ${item.title}`}><ExternalLink size={13} /></Link>}</div>{item.movable && (moving === item.key ? <div className="calendar-move"><input type="date" defaultValue={day} autoFocus disabled={pending} onChange={(event) => move(item, event.target.value)} aria-label={`Move ${item.title} to another day`} />{pending ? <Loader2 size={13} className="spin" /> : <button type="button" onClick={() => setMoving(null)}>Cancel</button>}</div> : <button type="button" className="calendar-move-open" onClick={() => setMoving(item.key)}>Move</button>)}</li>)}</ul>}
    <p className="calendar-panel-foot">Move edits the original task, exam, event or goal. Nothing is copied.</p>
  </aside>;
}
