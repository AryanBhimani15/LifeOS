/**
 * Spending sparkline drawn from real amounts.
 *
 * The mockup used a fixed path, which meant the line looked identical whatever
 * you had spent. This scales to the data and renders nothing when there is none,
 * rather than showing a shape that implies activity that did not happen.
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <p className="sparkline-empty">Not enough data yet.</p>;
  }

  const width = 430;
  const height = 72;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);

  // Running total: spending is cumulative over the period, so a rising line
  // means "spent more", which is what someone reading it expects. Built with
  // reduce rather than a mutated closure variable, which is not safe to
  // reassign across renders.
  const cumulative = values.reduce<number[]>(
    (acc, value) => [...acc, (acc[acc.length - 1] ?? 0) + value],
    [],
  );
  const peak = cumulative[cumulative.length - 1] || max;

  const points = cumulative.map((value, index) => {
    const x = index * step;
    const y = height - 8 - (value / peak) * (height - 20);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  const line = `M${points.join(" L")}`;
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Cumulative spending across ${values.length} transactions`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spend-fill" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="currentColor" stopOpacity=".28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spend-fill)" />
      <path d={line} fill="none" />
    </svg>
  );
}
