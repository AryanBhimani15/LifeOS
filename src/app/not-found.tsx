import Link from "next/link";
import { ArrowUpRight, Compass } from "lucide-react";

/**
 * 404.
 *
 * Replaces Next.js's bare "This page could not be found", which gives no clue
 * whether the app is broken or the URL was simply wrong. This one names the
 * routes that exist so the answer is obvious either way.
 */
export default function NotFound() {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <span className="not-built-icon">
          <Compass size={20} />
        </span>
        <h1>That page doesn&apos;t exist</h1>
        <p className="auth-sub">
          The URL didn&apos;t match any route. These are the ones that do:
        </p>

        <ul className="notfound-list">
          <li>
            <Link href="/today">/today</Link> <small>priorities, timeline, habits, goals</small>
          </li>
          <li>
            <Link href="/tasks">/tasks</Link> <small>the Kanban board</small>
          </li>
          <li>
            <Link href="/projects">/projects</Link>{" "}
            <small>and /calendar, /goals, /habits, /notes, /journal, /money — no API yet</small>
          </li>
          <li>
            <Link href="/login">/login</Link> <small>or /register</small>
          </li>
        </ul>

        <p className="auth-alt">
          <Link href="/today">
            Back to Today <ArrowUpRight size={13} />
          </Link>
        </p>
      </div>
    </main>
  );
}
