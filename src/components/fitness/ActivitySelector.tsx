"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
 * Since it replaces a native control it has to earn that back: it is reachable
 * and operable from the keyboard alone (arrows move, Enter picks, Escape
 * closes, Tab leaves), it announces itself as a listbox, and closing always
 * returns focus to the trigger.
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
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = activities.find((a) => a.id === value) ?? activities[0];

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((a) => a.name.toLowerCase().includes(needle));
  }, [activities, query]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

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

  return (
    <div className="fit-select" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="fit-select-trigger"
        onClick={() => setOpen((v) => !v)}
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

      {open && (
        <div className="fit-select-panel" onKeyDown={onKeyDown}>
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
      )}
    </div>
  );
}
