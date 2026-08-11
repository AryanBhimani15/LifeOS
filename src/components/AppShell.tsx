"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Circle,
  FileText,
  Folder,
  Heart,
  LayoutDashboard,
  LogOut,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import { signOutAction } from "@/app/(app)/actions";
import { useTheme } from "@/lib/theme";
import { CommandBar } from "./CommandBar";
import { ToastProvider } from "./ToastProvider";

/**
 * The application shell: sidebar, theme, command bar.
 *
 * Navigation uses real `<Link>` elements pointing at real routes. The original
 * mockup used `<button onClick={showToast}>`, which looked identical but went
 * nowhere — worth noting because that is exactly the failure this replaces.
 */

const NAV = [
  { icon: LayoutDashboard, label: "Today", href: "/today" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: Folder, label: "Projects", href: "/projects" },
  { icon: CalendarDays, label: "Calendar", href: "/calendar" },
  { icon: Target, label: "Goals", href: "/goals" },
  { icon: Heart, label: "Habits", href: "/habits" },
  { icon: FileText, label: "Notes", href: "/notes" },
  { icon: BookOpen, label: "Journal", href: "/journal" },
  { icon: Wallet, label: "Money", href: "/money" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The theme class lives on <html>, applied before paint by an inline script.
  const { isDark, toggle } = useTheme();

  return (
    <ToastProvider>
      <div className="lifeos-app">
        <div className="ambient-orb ambient-one" />
        <div className="ambient-orb ambient-two" />

        <aside className="sidebar">
          <div>
            <div className="brand">
              <span className="brand-mark">✦</span>
              <span>LifeOS</span>
              <ChevronDown size={14} />
            </div>
            <nav className="nav-list" aria-label="Main navigation">
              {NAV.map(({ icon: Icon, label, href }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-item ${active ? "selected" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={16} strokeWidth={1.8} /> <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="side-footer">
            <Link href="/settings" aria-label="Settings">
              <Settings size={16} />
            </Link>
            <form action={signOutAction}>
              <button type="submit" aria-label="Sign out" title="Sign out">
                <LogOut size={16} />
              </button>
            </form>
            <button
              className="theme-toggle"
              aria-label="Switch theme"
              onClick={toggle}
            >
              <Circle size={15} fill="currentColor" />
            </button>
          </div>
        </aside>

        <section className="dashboard">{children}</section>

        <CommandBar isDark={isDark} onToggleTheme={toggle} />
      </div>
    </ToastProvider>
  );
}
