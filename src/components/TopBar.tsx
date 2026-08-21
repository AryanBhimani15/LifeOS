"use client";

import Link from "next/link";
import { Command, LogOut, Moon, Search, Sun } from "lucide-react";
import { signOutAction } from "@/app/(app)/actions";
import { NotificationBell } from "@/components/NotificationBell";
import { setTheme, useTheme } from "@/lib/theme";

/**
 * The utility bar: theme and sign out, in one place, at the top of every page.
 *
 * Both used to be unlabelled icons tucked in the sidebar footer — a circle that
 * gave no clue which theme was active, and a door glyph for signing out that
 * read as decoration. The theme also had a second switch buried in the command
 * bar, so there were two controls for one setting and no way to tell what the
 * setting was.
 *
 * Now: one segmented control that shows which mode is on by highlighting it,
 * and a sign-out button with the word on it.
 */
export function TopBar() {
  const { isDark } = useTheme();

  function openCommand() {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  }

  return (
    <div className="topbar-utility">
      <button type="button" className="topbar-ask" onClick={openCommand}>
        <Search size={16} />
        <span>Ask LifeOS anything...</span>
        <kbd><Command size={12} /> K</kbd>
      </button>
      <div
        className="theme-seg"
        role="group"
        aria-label={`Theme: ${isDark ? "dark" : "light"}`}
      >
        {/* Each half is a real button pinned to one mode rather than a blind
            toggle, so clicking the mode you are already in does nothing
            surprising, and the highlight always states the current setting. */}
        <button
          type="button"
          className={!isDark ? "is-active" : ""}
          onClick={() => setTheme(false)}
          aria-pressed={!isDark}
          title="Light mode"
        >
          <Sun size={14} strokeWidth={2} />
          <span>Light</span>
        </button>
        <button
          type="button"
          className={isDark ? "is-active" : ""}
          onClick={() => setTheme(true)}
          aria-pressed={isDark}
          title="Dark mode"
        >
          <Moon size={14} strokeWidth={2} />
          <span>Dark</span>
        </button>
      </div>
      <NotificationBell />
      <Link href="/profile" className="topbar-profile" aria-label="Open profile" title="Profile">A</Link>
      <form action={signOutAction}>
        <button type="submit" className="topbar-signout" title="Sign out" aria-label="Sign out">
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </form>
    </div>
  );
}
