"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Theme as external state, not React state.
 *
 * The theme lives on `<html>` and in localStorage — both external systems that
 * exist before React hydrates. Reading them into state inside an effect causes
 * a cascading render (and a flash of the wrong theme), so this subscribes to
 * them with `useSyncExternalStore` instead.
 *
 * An inline script in the root layout applies the class before first paint, so
 * the server and client agree on the very first frame.
 */

const STORAGE_KEY = "lifeos-theme";
const DARK_CLASS = "dark-mode";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains(DARK_CLASS);
}

/** The server has no DOM; the inline script decides the real value on the client. */
function getServerSnapshot(): boolean {
  return false;
}

export function setTheme(dark: boolean) {
  document.documentElement.classList.toggle(DARK_CLASS, dark);
  try {
    window.localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Private browsing can reject writes; the class is still applied.
  }
  emit();
}

export function useTheme() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => setTheme(!getSnapshot()), []);
  return { isDark, toggle };
}

/**
 * Runs before first paint, so there is no flash of the wrong theme and the
 * hydrated markup matches what is already on screen.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var s=localStorage.getItem('${STORAGE_KEY}');
  var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  if(d)document.documentElement.classList.add('${DARK_CLASS}');
}catch(e){}})();
`.trim();
