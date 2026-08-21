import Link from "next/link";
import { AlertCircle, CalendarDays, GraduationCap } from "lucide-react";

type Upcoming = {
  title: string;
  href: string;
  label: "Next exam" | "Overdue work" | "High-priority deadline" | "Upcoming deadline" | "Upcoming event";
  at: string;
  allDay: boolean;
  dueHasTime?: boolean;
  kind: "TASK" | "EXAM" | "EVENT" | "DEADLINE";
  overdue: boolean;
};

function dateLine(item: Upcoming, timeZone: string) {
  if (item.overdue) return "Overdue — needs your attention";
  const date = new Date(item.at);
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 86_400_000));
  const prefix = day === today ? "Today" : day === tomorrow ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
  const timed = !item.allDay && item.dueHasTime !== false;
  return timed ? `${prefix} · ${new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date)}` : prefix;
}

export function HomeImportantUpcoming({ upcoming, timeZone }: { upcoming: Upcoming | null; timeZone: string }) {
  if (!upcoming) return null;
  const Icon = upcoming.kind === "EXAM" ? GraduationCap : upcoming.overdue ? AlertCircle : CalendarDays;
  return (
    <Link href={upcoming.href} className={`home-important-upcoming ${upcoming.overdue ? "is-overdue" : ""}`}>
      <span className="home-important-icon"><Icon size={21} /></span>
      <span className="home-important-copy">
        <small>{upcoming.label}</small>
        <b>{upcoming.title}</b>
        <em>{dateLine(upcoming, timeZone)}</em>
      </span>
      {!upcoming.overdue && <span className="home-important-arrow">Open</span>}
    </Link>
  );
}
