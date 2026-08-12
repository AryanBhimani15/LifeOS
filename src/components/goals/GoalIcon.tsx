import {
  BookOpen,
  Brain,
  Code,
  Dumbbell,
  GraduationCap,
  Heart,
  Plane,
  Sprout,
  Target,
  Wallet,
} from "lucide-react";
import { DEFAULT_GOAL_ICON, isGoalIcon, type GoalIcon as GoalIconName } from "@/lib/goals";

/**
 * A goal's icon, resolved from a stored key.
 *
 * The lookup is closed: an unknown or tampered value falls back to the default
 * rather than rendering anything the database happened to contain.
 */
const ICONS: Record<GoalIconName, typeof Target> = {
  target: Target,
  "graduation-cap": GraduationCap,
  wallet: Wallet,
  dumbbell: Dumbbell,
  "book-open": BookOpen,
  brain: Brain,
  heart: Heart,
  sprout: Sprout,
  code: Code,
  plane: Plane,
};

export function GoalIcon({ name, size = 18 }: { name?: string | null; size?: number }) {
  const Icon = ICONS[isGoalIcon(name) ? name : DEFAULT_GOAL_ICON];
  return <Icon size={size} strokeWidth={1.9} />;
}

export const GOAL_ICON_KEYS = Object.keys(ICONS) as GoalIconName[];
