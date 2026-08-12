"use client";

import { Hand } from "lucide-react";
import { mmToCm, gramsToKg } from "@/lib/fitness";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

/**
 * The illustrations for each onboarding question.
 *
 * Two rules shaped these. Every question gets its own drawing — a single
 * decorative loop reused six times reads as filler, and the point is that the
 * screen looks like it knows what it just asked. And the two questions with a
 * number attached (height, weight) are drawn *from* that number, so moving the
 * slider moves the picture; they are the only two that need to be more than
 * decoration.
 *
 * Everything is inline SVG driven by CSS in globals.css. No animation library:
 * these are transforms and opacity, which the compositor handles for free, and
 * the global prefers-reduced-motion rule already flattens them.
 */

// ---------------------------------------------------------------------------
// 1 · Name — a hand that waves
// ---------------------------------------------------------------------------

export function WaveArt() {
  return (
    <div className="ob-art ob-art-wave" aria-hidden="true">
      <span className="ob-ring" />
      <span className="ob-ring ob-ring-late" />
      <span className="ob-wave-hand">
        <Hand size={34} strokeWidth={1.5} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 · Age — a calendar filling itself in
// ---------------------------------------------------------------------------

/** Cell centres for a 5×3 grid, laid out once rather than nested-mapped. */
const CALENDAR_CELLS = Array.from({ length: 15 }, (_, i) => ({
  x: 26 + (i % 5) * 12,
  y: 46 + Math.floor(i / 5) * 12,
  /** The 9th cell is the one that lights up — roughly mid-month, off-centre. */
  marked: i === 8,
}));

export function CalendarArt() {
  return (
    <div className="ob-art" aria-hidden="true">
      <svg viewBox="0 0 100 90" className="ob-svg">
        <rect x="14" y="18" width="72" height="62" rx="9" className="ob-stroke" />
        <path d="M14 34 H86" className="ob-stroke" />
        <path d="M32 12 V24 M68 12 V24" className="ob-stroke ob-cap" />

        {CALENDAR_CELLS.map((cell, i) =>
          cell.marked ? (
            <g key={i}>
              <circle cx={cell.x} cy={cell.y} r="7" className="ob-cal-halo" />
              <circle cx={cell.x} cy={cell.y} r="3.4" className="ob-cal-today" />
            </g>
          ) : (
            <circle
              key={i}
              cx={cell.x}
              cy={cell.y}
              r="2.1"
              className="ob-cal-dot"
              style={{ animationDelay: `${i * 55}ms` }}
            />
          ),
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2b · Life context — a week filling up
// ---------------------------------------------------------------------------

/**
 * Five weekday columns with blocks settling into them, and two lighter weekend
 * columns. The question is "what does your week look like", so the drawing is
 * a week.
 */
export function WeekArt() {
  const columns = [
    { x: 16, blocks: [0, 1] },
    { x: 38, blocks: [0, 1, 2] },
    { x: 60, blocks: [0] },
    { x: 82, blocks: [0, 1, 2] },
    { x: 104, blocks: [0, 1] },
  ];

  return (
    <div className="ob-art" aria-hidden="true">
      <svg viewBox="0 0 150 90" className="ob-svg">
        <path d="M6 76 H144" className="ob-ground" />
        {columns.map((column, i) =>
          column.blocks.map((row) => (
            <rect
              key={`${i}-${row}`}
              x={column.x}
              y={68 - row * 15}
              width="16"
              height="12"
              rx="3"
              className="ob-week-block"
              style={{ animationDelay: `${(i * 3 + row) * 70}ms` }}
            />
          )),
        )}
        {[126].map((x) => (
          <rect key={x} x={x} y="56" width="16" height="12" rx="3" className="ob-week-block ob-week-rest" style={{ animationDelay: "560ms" }} />
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2c · Goal — an arrow finding the target
// ---------------------------------------------------------------------------

/**
 * A bullseye, drawn as a bullseye.
 *
 * The first attempt was two hairline rings with a dot and a line poking out of
 * the side, which read as a diagram of something else entirely. Four graded
 * rings and a dart that lands in the centre is legible at a glance, which is
 * the only job an illustration above a question has.
 */
export function TargetArt() {
  return (
    <div className="ob-art" aria-hidden="true">
      <svg viewBox="0 0 120 100" className="ob-svg">
        <circle cx="60" cy="50" r="38" className="ob-target-ring" />
        <circle cx="60" cy="50" r="27" className="ob-target-ring ob-target-mid" />
        <circle cx="60" cy="50" r="16" className="ob-target-ring ob-target-inner" />
        <circle cx="60" cy="50" r="7" className="ob-target-centre" />

        {/* Comes in from above at an angle, so it reads as thrown rather than
            as a line attached to the side of the drawing. */}
        <g className="ob-arrow">
          <path d="M84 26 L63 47" className="ob-arrow-shaft" />
          <path d="M88 16 L86 28 L74 30 z" className="ob-arrow-fletch" />
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Sex — a figure that responds when its option is chosen
// ---------------------------------------------------------------------------

/**
 * Drawn rather than taken from the icon set so the two glyphs differ only in
 * silhouette, at identical weight and size. Mixing two stock icons for a
 * side-by-side comparison makes one look heavier than the other.
 */
export function FigureGlyph({ variant }: { variant: "MALE" | "FEMALE" }) {
  return (
    <svg viewBox="0 0 44 56" className="ob-figure" aria-hidden="true">
      <circle cx="22" cy="10.5" r="6.5" className="ob-figure-head" />
      {variant === "MALE" ? (
        // Square shoulders tapering to a straight torso.
        <path
          d="M11 33 c0-6.5 4.9-11 11-11 s11 4.5 11 11 v3 h-5.5 l-1.5 14 h-8 l-1.5-14 H11 z"
          className="ob-figure-body"
        />
      ) : (
        // The same head and shoulder width; the silhouette flares instead of
        // dropping straight, so the two read as a pair rather than as two
        // unrelated icons at different weights.
        <path
          d="M22 22 c-6 0-10 4-11.5 10 l-2.5 9 h6 l-1 9 h18 l-1-9 h6 l-2.5-9 c-1.5-6-5.5-10-11.5-10 z"
          className="ob-figure-body"
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 4 · Height — a ruler with a figure that actually grows
// ---------------------------------------------------------------------------

/** The drawing's range. Values outside it clamp rather than escape the frame. */
const ART_MIN_CM = 120;
const ART_MAX_CM = 215;
const BASELINE = 132;
const MIN_DRAWN = 42;
const MAX_DRAWN = 116;

export function HeightArt({ heightMm, label }: { heightMm: number; label: string }) {
  // Eased rather than jumped, so typing "185" over "170" grows the figure
  // instead of teleporting it. Dragging the slider still tracks the thumb.
  const cm = useAnimatedNumber(Math.min(ART_MAX_CM, Math.max(ART_MIN_CM, mmToCm(heightMm))));
  const ratio = (cm - ART_MIN_CM) / (ART_MAX_CM - ART_MIN_CM);
  const drawn = MIN_DRAWN + ratio * (MAX_DRAWN - MIN_DRAWN);

  // The figure is rebuilt from its height rather than scaled, so the head stays
  // a circle and the proportions stay believable at both extremes.
  const headR = 4.2 + drawn * 0.055;
  const headCy = BASELINE - drawn + headR;
  const shoulders = headCy + headR + drawn * 0.06;
  const hips = BASELINE - drawn * 0.44;
  const armSpan = 7 + drawn * 0.11;
  const top = BASELINE - drawn;

  // Ticks share the figure's scale, so the measurement line always lands on the
  // mark for that height rather than merely near it.
  const ticks = [];
  for (let value = ART_MIN_CM; value <= 210; value += 10) {
    const y =
      BASELINE - MIN_DRAWN - ((value - ART_MIN_CM) / (ART_MAX_CM - ART_MIN_CM)) * (MAX_DRAWN - MIN_DRAWN);
    ticks.push({ value, y, major: value % 20 === 0 });
  }

  return (
    <div className="ob-art ob-art-tall" aria-hidden="true">
      <svg viewBox="0 0 150 150" className="ob-svg">
        {/* Ruler */}
        <path d="M30 8 V138" className="ob-rule" />
        {ticks.map((tick) => (
          <path
            key={tick.value}
            d={`M30 ${tick.y} H${tick.major ? 44 : 38}`}
            className={tick.major ? "ob-rule" : "ob-rule ob-rule-minor"}
          />
        ))}

        {/* Ground */}
        <path d={`M26 ${BASELINE} H132`} className="ob-ground" />

        {/* Figure */}
        <g className="ob-person">
          <circle cx="88" cy={headCy} r={headR} className="ob-stroke" />
          <path
            d={`M88 ${shoulders} V${hips}
                M${88 - armSpan} ${shoulders + drawn * 0.14} L88 ${shoulders + drawn * 0.02} L${88 + armSpan} ${shoulders + drawn * 0.14}
                M${88 - armSpan * 0.72} ${BASELINE} L88 ${hips} L${88 + armSpan * 0.72} ${BASELINE}`}
            className="ob-stroke ob-cap"
          />
        </g>

        {/* Live measurement line. Positioned with the SVG transform attribute
            rather than a CSS transform: percentages and px in CSS transforms
            resolve against the box model, which is not what an SVG user-unit
            offset means. */}
        <g className="ob-measure" transform={`translate(0 ${(top - 20).toFixed(2)})`}>
          <path d="M30 20 H126" className="ob-measure-line" />
          <text x="126" y="15" className="ob-measure-label" textAnchor="end">
            {label}
          </text>
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 · Weight — a dial whose needle settles on the number
// ---------------------------------------------------------------------------

const DIAL_MIN_KG = 20;
const DIAL_MAX_KG = 200;
const SWEEP = 250; // degrees of travel, centred on straight up

export function WeightArt({ weightGrams, label }: { weightGrams: number; label: string }) {
  const kg = useAnimatedNumber(
    Math.min(DIAL_MAX_KG, Math.max(DIAL_MIN_KG, gramsToKg(weightGrams))),
    { duration: 300 },
  );
  const ratio = (kg - DIAL_MIN_KG) / (DIAL_MAX_KG - DIAL_MIN_KG);
  const angle = -SWEEP / 2 + ratio * SWEEP;

  /** Tick every 12.5° across the sweep, longer every fourth. */
  const ticks = Array.from({ length: 21 }, (_, i) => ({
    angle: -SWEEP / 2 + (i / 20) * SWEEP,
    major: i % 4 === 0,
  }));

  return (
    <div className="ob-art" aria-hidden="true">
      <svg viewBox="0 0 150 110" className="ob-svg">
        {/* The body presses towards its feet as the number climbs — the whole
            drawing moves, which reads as weight rather than as a gauge. */}
        <g transform={`translate(0 ${(ratio * 4).toFixed(2)})`}>
          <rect x="25" y="12" width="100" height="76" rx="15" className="ob-scale-body" />

          <g transform="translate(75 56)">
            {ticks.map((tick) => (
              <path
                key={tick.angle}
                d={`M0 -34 V${tick.major ? -27 : -30}`}
                className={tick.major ? "ob-rule" : "ob-rule ob-rule-minor"}
                transform={`rotate(${tick.angle})`}
              />
            ))}

            <g className="ob-needle" transform={`rotate(${angle.toFixed(2)})`}>
              <path d="M0 4 V-25" className="ob-needle-arm" />
            </g>
            <circle r="3.4" className="ob-needle-hub" />
          </g>

          <text x="75" y="80" className="ob-dial-label" textAnchor="middle">
            {label}
          </text>
        </g>

        <path d="M42 92 V99 M108 92 V99" className="ob-scale-feet" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6 · Activity level — one glyph per option
// ---------------------------------------------------------------------------

/**
 * Five small drawings, each animating only when its option is selected. All
 * five moving at once would turn the list into a fidget toy and make the
 * selected state harder to see, not easier.
 */
export function ActivityGlyph({ level }: { level: string }) {
  switch (level) {
    case "SEDENTARY":
      return (
        <svg viewBox="0 0 28 28" className="ob-glyph" aria-hidden="true">
          <path d="M7 20 V13 a2 2 0 0 1 2-2 h10 a2 2 0 0 1 2 2 v7" className="ob-stroke ob-cap" />
          <path d="M5 20 h18 M8 20 v3 M20 20 v3" className="ob-stroke ob-cap" />
          <circle cx="14" cy="7" r="1.4" className="ob-glyph-breath" />
        </svg>
      );
    case "LIGHTLY_ACTIVE":
      return (
        <svg viewBox="0 0 28 28" className="ob-glyph" aria-hidden="true">
          <path d="M9 21 c0-4 1-6 1-9" className="ob-stroke ob-cap ob-step-a" />
          <path d="M18 21 c0-4-1-6-1-9" className="ob-stroke ob-cap ob-step-b" />
          <circle cx="10" cy="8" r="2" className="ob-stroke ob-step-a" />
          <circle cx="17" cy="8" r="2" className="ob-stroke ob-step-b" />
        </svg>
      );
    case "MODERATELY_ACTIVE":
      return (
        <svg viewBox="0 0 28 28" className="ob-glyph" aria-hidden="true">
          <path d="M3 15 h5 l2.5-6 4 12 3-7 2.5 4 H25" className="ob-stroke ob-cap ob-pulse-line" />
        </svg>
      );
    case "VERY_ACTIVE":
      return (
        <svg viewBox="0 0 28 28" className="ob-glyph" aria-hidden="true">
          <circle cx="14" cy="14" r="9" className="ob-stroke ob-orbit-track" />
          <circle cx="14" cy="5" r="2.2" className="ob-orbit-dot" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 28 28" className="ob-glyph" aria-hidden="true">
          <path d="M15 3 L8 15 h5 l-2 10 8-13 h-5 z" className="ob-stroke ob-cap ob-bolt" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// 7 · Completion — a sunrise
// ---------------------------------------------------------------------------

/**
 * A sun coming up over a horizon, not a flame.
 *
 * The flame belonged to a calorie tracker. What actually just happened is that
 * someone set up the place they will plan their weeks from, so the drawing is
 * about a day starting rather than about burning something.
 */
export function CompletionArt() {
  const rays = [-70, -45, -20, 5, 30, 55];

  return (
    <div className="ob-art ob-art-sunrise" aria-hidden="true">
      <span className="ob-glow" />
      <svg viewBox="0 0 140 96" className="ob-svg">
        <g className="ob-rays">
          {rays.map((angle, i) => (
            <path
              key={angle}
              d="M70 42 V22"
              className="ob-ray"
              transform={`rotate(${angle} 70 68)`}
              style={{ animationDelay: `${260 + i * 90}ms` }}
            />
          ))}
        </g>

        <circle cx="70" cy="68" r="22" className="ob-sun" />
        <path d="M14 68 H126" className="ob-horizon" />
        <path d="M26 80 H60 M76 80 H114" className="ob-horizon ob-horizon-far" />
      </svg>
    </div>
  );
}
