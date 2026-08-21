"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  FileText,
  Flame,
  Folder,
  GraduationCap,
  Heart,
  LayoutDashboard,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import type { Palette } from "@/lib/validation/settings";
import { CommandBar } from "./CommandBar";
import { ToastProvider } from "./ToastProvider";
import { TopBar } from "./TopBar";

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
  { icon: GraduationCap, label: "Exams", href: "/exams" },
  { icon: Target, label: "Goals", href: "/goals" },
  { icon: Heart, label: "Habits", href: "/habits" },
  { icon: Flame, label: "Fitness", href: "/fitness" },
  { icon: FileText, label: "Notes", href: "/notes" },
  { icon: BookOpen, label: "Journal", href: "/journal" },
  { icon: Wallet, label: "Money", href: "/money" },
] as const;

export function AppShell({
  children,
  palette = "rose",
}: {
  children: React.ReactNode;
  /** Tints the whole product. Seeded by setup, changed in Settings. */
  palette?: Palette;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <div className="lifeos-app" data-palette={palette}>
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

          {/* Theme and sign out moved to the top bar, where they are labelled
              and always in view. What is left here is what belongs in a
              sidebar: navigation. */}
          <div className="side-footer">
            <Link href="/settings" className="side-settings">
              <Settings size={15} /> <span>Settings</span>
            </Link>
          </div>
        </aside>

        <section className="dashboard">
          <TopBar />
          {children}
        </section>

        <CommandBar />
      </div>
    </ToastProvider>
  );
}
