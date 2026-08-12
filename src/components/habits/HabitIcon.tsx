import {
  BookOpen,
  Brain,
  Droplet,
  Dumbbell,
  Footprints,
  Heart,
  Moon,
  PenLine,
  Sparkles,
  Sun,
} from "lucide-react";
import { DEFAULT_HABIT_ICON, isHabitIcon, type HabitIconName } from "@/lib/habits";

/** A habit's icon, resolved from a stored key. Unknown values fall back. */
const ICONS: Record<HabitIconName, typeof Sparkles> = {
  sparkles: Sparkles,
  droplet: Droplet,
  "book-open": BookOpen,
  dumbbell: Dumbbell,
  brain: Brain,
  moon: Moon,
  sun: Sun,
  footprints: Footprints,
  "pen-line": PenLine,
  heart: Heart,
};

export function HabitIcon({ name, size = 17 }: { name?: string | null; size?: number }) {
  const Icon = ICONS[isHabitIcon(name) ? name : DEFAULT_HABIT_ICON];
  return <Icon size={size} strokeWidth={1.9} />;
}

export const HABIT_ICON_KEYS = Object.keys(ICONS) as HabitIconName[];
