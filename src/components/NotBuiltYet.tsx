import Link from "next/link";
import { ArrowUpRight, Construction } from "lucide-react";

/**
 * Placeholder for a section whose API does not exist yet.
 *
 * It says so plainly instead of rendering convincing sample data. A screen full
 * of fake rows is worse than an empty one: it reads as working software and
 * hides how much is actually left to build.
 */
export function NotBuiltYet({
  title,
  what,
  schemaReady,
}: {
  title: string;
  what: string;
  schemaReady: string;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">NOT BUILT YET</p>
          <h1>{title}</h1>
        </div>
      </header>

      <div className="not-built">
        <span className="not-built-icon">
          <Construction size={20} />
        </span>
        <h2>{what}</h2>
        <p>
          This section has no API yet, so there is nothing real to show. Rather than fill it with
          sample rows that look like data, it is honest about being unfinished.
        </p>
        <p className="not-built-detail">
          <strong>Already in place:</strong> {schemaReady}
        </p>
        <div className="not-built-actions">
          <Link href="/today" className="empty-action">
            Back to Today <ArrowUpRight size={13} />
          </Link>
          <Link href="/tasks" className="empty-action">
            Tasks (working) <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </>
  );
}
