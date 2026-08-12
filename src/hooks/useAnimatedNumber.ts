"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Eases a number towards a target across frames.
 *
 * Two things in this feature move because a number moved — the scale needle and
 * the calorie total — and both look wrong if they snap. CSS cannot help: these
 * drive SVG geometry and text content, not a transform.
 *
 * A tween that restarts from wherever the previous one had reached, rather than
 * from the last target, is what makes dragging a slider look like following
 * instead of stuttering.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches;
}

export function useAnimatedNumber(
  target: number,
  { duration = 220, from }: { duration?: number; from?: number } = {},
): number {
  const [value, setValue] = useState(from ?? target);
  // Tracks the displayed value across renders so an interrupted tween can
  // continue from where it actually is.
  const current = useRef(from ?? target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const origin = current.current;

    // Honouring the OS setting has to happen here as well as in CSS — a count-up
    // is JavaScript, and the media query in globals.css cannot reach it.
    if (origin === target || duration <= 0 || prefersReducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = origin + (target - origin) * eased;
      current.current = next;
      setValue(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return value;
}
