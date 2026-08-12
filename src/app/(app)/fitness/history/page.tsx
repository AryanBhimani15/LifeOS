import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { formatDuration } from "@/lib/fitness";
import { getFitnessStats, listHistory } from "@/lib/repositories/fitness";
import { HistoryList } from "@/components/fitness/HistoryList";

export const metadata = { title: "LifeOS — Workout history" };

/**
 * Every saved calculation.
 *
 * Capped at 100 rows rather than paginated: this is a personal log, and the
 * honest summary of the whole record is the totals line at the top. Paging
 * controls for a list nobody scrolls to the end of would be furniture.
 */
export default async function FitnessHistoryPage() {
  const userId = await requireUserId();
  const [entries, stats] = await Promise.all([listHistory(userId, 100), getFitnessStats(userId)]);

  const totalCalories = entries.reduce((sum, entry) => sum + entry.caloriesBurned, 0);
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">WORKOUT LOG</p>
          <h1>History</h1>
          <p className="fit-subtitle">
            {entries.length === 0
              ? "No workouts saved yet."
              : `${entries.length} workout${entries.length === 1 ? "" : "s"} · ${totalCalories.toLocaleString()} kcal · ${formatDuration(totalMinutes)}`}
          </p>
        </div>
        <div className="header-actions">
          <Link className="icon-button fit-history-link" href="/fitness">
            <ArrowLeft size={15} /> Back
          </Link>
        </div>
      </header>

      <section className="fit-card fit-history-card reveal delay-1">
        <HistoryList
          entries={entries}
          zone={stats.zone}
          emptyMessage="Calculate a workout and save it — it will show up here."
        />
      </section>
    </>
  );
}
