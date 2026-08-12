import Link from "next/link";
import { CalendarDays, ChevronRight, GraduationCap, MapPin } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { dayLabel, daysLeft, timeRange } from "@/components/events/UpcomingEvent";

export const metadata = { title: "LifeOS — Exams" };

export default async function ExamsPage() {
  const userId = await requireUserId();
  const exams = await db.event.findMany({
    where: { userId, kind: "EXAM", isTemplate: false },
    select: { id: true, title: true, startAt: true, endAt: true, allDay: true, location: true, description: true, documents: { select: { id: true } } },
    orderBy: { startAt: "asc" },
  });
  const upcoming = exams.filter((exam) => exam.startAt >= new Date());
  const past = exams.filter((exam) => exam.startAt < new Date());
  return <>
    <header className="topbar"><div><p className="eyebrow">STUDY &amp; ASSESSMENT</p><h1>Exams</h1><p className="exams-subtitle">Everything you need for the exams ahead.</p></div></header>
    <section className="exams-hero"><span><GraduationCap size={25} /></span><div><small>UP NEXT</small><h2>{upcoming[0]?.title ?? "No exam scheduled"}</h2><p>{upcoming[0] ? `${dayLabel(upcoming[0].startAt)} · ${timeRange(upcoming[0].startAt, upcoming[0].endAt, upcoming[0].allDay)}` : "Add an exam from Add something to start preparing."}</p></div>{upcoming[0] && <Link href={`/events/${upcoming[0].id}`}>Open exam <ChevronRight size={16} /></Link>}</section>
    <section className="exams-section"><header><h2>Upcoming exams</h2><span>{upcoming.length} upcoming</span></header>{upcoming.length ? <div className="exam-grid">{upcoming.map((exam) => <Link key={exam.id} href={`/events/${exam.id}`} className="exam-card"><span className="exam-icon"><CalendarDays size={19} /></span><div><small>EXAM · {daysLeft(exam.startAt) <= 0 ? "Today" : `${daysLeft(exam.startAt)} days left`}</small><h3>{exam.title}</h3><p>{dayLabel(exam.startAt)} · {timeRange(exam.startAt, exam.endAt, exam.allDay)}</p>{exam.location && <p><MapPin size={12} /> {exam.location}</p>}<em>{exam.documents.length} resource{exam.documents.length === 1 ? "" : "s"}</em></div><ChevronRight size={17} /></Link>)}</div> : <div className="exams-empty">No upcoming exams. Create one from the Add something flow.</div>}</section>
    {past.length > 0 && <section className="exams-section exams-past"><header><h2>Past exams</h2></header><div className="exam-grid">{past.map((exam) => <Link key={exam.id} href={`/events/${exam.id}`} className="exam-card"><span className="exam-icon"><CalendarDays size={19} /></span><div><h3>{exam.title}</h3><p>{dayLabel(exam.startAt)} · {timeRange(exam.startAt, exam.endAt, exam.allDay)}</p></div><ChevronRight size={17} /></Link>)}</div></section>}
  </>;
}
