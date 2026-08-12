"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Activity } from "@/lib/repositories/fitness";
import { ActivityIcon } from "./ActivityIcon";

/**
 * A searchable activity picker.
 *
 * Built rather than borrowed because the native `<select>` cannot show an icon
 * and a rate next to each option, and the twelve-row list is long enough that
 * typing to filter is faster than scrolling.
 *
 * ## Why this renders in a portal
 *
 * The menu used to be `position: absolute` inside the selector, which is the
 * obvious approach and was wrong here. Every `.section` on the page carries the
 * `reveal` entrance animation, and `animation-fill-mode: both` leaves the final
 * keyframe applied forever — including `transform`, which resolves to an
 * *identity matrix* rather than `none`. A non-`none` transform creates a
 * stacking context, so each section became one, the menu's `z-index` was
 * confined to its own section, and the later "Recent" section painted straight
 * over the top of it.
 *
 * Raising the z-index cannot fix that: the value is meaningless outside the
 * context it lives in. Neither can `overflow` juggling — `.lifeos-app` clips
 * with `overflow: hidden` further up.
 *
 * So the menu is portalled to `document.body` and positioned with `fixed`
 * coordinates measured from the trigger. It is then a sibling of the app shell,
 * subject to no ancestor's stacking context or clipping, and it flips above the
 * trigger when there is not enough room below.
 */
export function ActivitySelector({
  activities,
  value,
  onChange,
}: {
  activities: Activity[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();

  /** Where the menu is drawn, in viewport coordinates. */
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    above: boolean;
  } | null>(null);

  const selected = activities.find((a) => a.id === value) ?? activities[0];

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((a) => a.name.toLowerCase().includes(needle));
  }, [activities, query]);

  /**
   * Measures the trigger and decides which way to open.
   *
   * Preference is downward, because that is what a dropdown is expected to do.
   * It flips only when the space below genuinely cannot hold a usable menu, and
   * in either direction the height is capped to what is actually available so
   * the list scrolls internally rather than running off the screen.
   */
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const GAP = 6;
    const EDGE = 12;
    const IDEAL = 300;

    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    // Flip only when below cannot show a reasonable menu *and* above is better.
    const flip = below < Math.min(IDEAL, 200) && above > below;
    const maxHeight = Math.max(140, Math.min(IDEAL, flip ? above : below));

    setPlacement({
      top: flip ? rect.top - GAP - maxHeight : rect.bottom + GAP,
      left: rect.left,
      width: rect.width,
      maxHeight,
      above: flip,
    });
  }, []);

  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel is no longer a descendant of the trigger, so both are checked.
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };

    // Fixed coordinates go stale the moment anything moves, so they are
    // recomputed rather than left behind. `capture` catches scrolling in any
    // container, not just the window.
    const onScrollOrResize = () => place();

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, place]);

  const close = (returnFocus = true) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) trigger.current?.focus();
  };

  const pick = (id: string) => {
    onChange(id);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((i) => (i + step + matches.length) % matches.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const choice = matches[highlight];
      if (choice) pick(choice.id);
    }
  };

  const menu = placement && (
    <div
      ref={panel}
      className={`fit-select-panel ${placement.above ? "is-above" : ""}`}
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      onKeyDown={onKeyDown}
    >
      <div className="fit-select-search">
        <Search size={14} />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Filtering shortens the list, so the cursor goes back to the
            // top with it — otherwise it can point past the last match.
            setHighlight(0);
          }}
          placeholder="Search activities"
          aria-label="Search activities"
          aria-controls={listId}
        />
      </div>

      <ul className="fit-select-list" id={listId} role="listbox" aria-label="Activities">
        {matches.length === 0 && <li className="fit-select-empty">No activity matches that.</li>}

        {matches.map((activity, i) => (
          <li key={activity.id}>
            <button
              type="button"
              role="option"
              aria-selected={activity.id === value}
              className={`fit-select-option ${i === highlight ? "is-active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(activity.id)}
            >
              <span className="fit-select-icon">
                <ActivityIcon icon={activity.icon} />
              </span>
              <span className="fit-select-name">{activity.name}</span>
              <span className="fit-select-rate">{activity.caloriesPerHour} kcal/hr</span>
              {activity.id === value && <Check size={14} className="fit-select-tick" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="fit-select">
      <button
        type="button"
        ref={trigger}
        className="fit-select-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close();
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="fit-select-icon">
          <ActivityIcon icon={selected?.icon ?? ""} />
        </span>
        <span className="fit-select-name">{selected?.name ?? "Choose an activity"}</span>
        <span className="fit-select-rate">{selected?.caloriesPerHour} kcal/hr</span>
        <ChevronDown size={15} className={`fit-select-chevron ${open ? "is-open" : ""}`} />
      </button>

      {/* No `mounted` guard needed: the menu only opens from a click, which
          cannot happen during a server render, so `document` always exists by
          the time this branch is reached. */}
      {open && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
