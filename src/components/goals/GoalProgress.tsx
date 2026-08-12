/**
 * The progress bar, and the sentence underneath that explains it.
 *
 * The percentage is never shown on its own. "75%" is only meaningful next to
 * "3 of 4 milestones", and printing the number without its source is how a
 * progress bar becomes decoration.
 */
export function GoalProgressBar({
  percent,
  detail,
  compact = false,
}: {
  percent: number;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className={`goal-progress ${compact ? "is-compact" : ""}`}>
      <div
        className="goal-progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={detail ? `${percent}% — ${detail}` : `${percent}% complete`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="goal-progress-meta">
        <b>{percent}%</b>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

/**
 * The trend on the detail page: recorded percentages over time.
 *
 * Absolute values, not a running total — a goal that sat at 40% for a month
 * must draw a flat line, and a cumulative chart would draw a climb.
 */
export function GoalTrend({ points }: { points: { percent: number; recordedAt: string }[] }) {
  if (points.length < 2) {
    return <p className="goal-trend-empty">The trend appears once progress has moved twice.</p>;
  }

  const width = 420;
  const height = 96;
  const step = width / (points.length - 1);
  const y = (percent: number) => height - 10 - (percent / 100) * (height - 22);

  const coords = points.map((point, index) => `${(index * step).toFixed(1)} ${y(point.percent).toFixed(1)}`);
  const line = `M${coords.join(" L")}`;

  const first = points[0];
  const last = points[points.length - 1];
  const change = last.percent - first.percent;

  return (
    <div className="goal-trend">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`Progress moved from ${first.percent}% to ${last.percent}% across ${points.length} recorded points`}>
        <defs>
          <linearGradient id="goal-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="currentColor" stopOpacity=".22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="url(#goal-trend-fill)" />
        <path d={line} fill="none" />
      </svg>
      <p>
        <b>{change >= 0 ? `+${change}` : change}%</b> since{" "}
        {new Date(first.recordedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })}
      </p>
    </div>
  );
}
