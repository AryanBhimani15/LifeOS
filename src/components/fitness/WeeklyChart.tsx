import type { DayStat } from "@/lib/repositories/fitness";

/**
 * Calories per day for the current week.
 *
 * Seven bars, drawn with divs. A charting library would add a few hundred
 * kilobytes and a client boundary to draw seven rectangles, and this way the
 * chart renders on the server with the rest of the page.
 *
 * Bars are scaled against the week's own best day rather than a fixed ceiling,
 * so the shape of the week is readable whether the days are 200 kcal or 2,000.
 * An empty week draws flat baselines instead of collapsing to nothing.
 */
export function WeeklyChart({ week, best }: { week: DayStat[]; best: number }) {
  const ceiling = Math.max(best, 1);

  return (
    <div className="fit-chart">
      {week.map((day, i) => {
        const height = day.calories === 0 ? 0 : Math.max(6, (day.calories / ceiling) * 100);
        return (
          <div className="fit-chart-col" key={day.date}>
            <div className="fit-chart-track">
              <div
                className={`fit-chart-bar ${day.isToday ? "is-today" : ""} ${day.calories === 0 ? "is-empty" : ""}`}
                style={{ height: `${height}%`, animationDelay: `${i * 45}ms` }}
              >
                {day.calories > 0 && <span className="fit-chart-value">{day.calories.toLocaleString()}</span>}
              </div>
            </div>
            <span className={`fit-chart-label ${day.isToday ? "is-today" : ""}`}>{day.label}</span>
          </div>
        );
      })}
    </div>
  );
}
