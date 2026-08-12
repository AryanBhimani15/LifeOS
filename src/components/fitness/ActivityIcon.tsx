import {
  Bike,
  Dumbbell,
  Flower2,
  Footprints,
  Goal,
  Mountain,
  Music,
  PersonStanding,
  Rabbit,
  Repeat,
  Volleyball,
  Waves,
  Zap,
} from "lucide-react";

/**
 * Resolves the icon key stored on an activity row to a component.
 *
 * The database holds a key, never markup: an SVG string from a table would
 * either need sanitising on every render or would be injected unsanitised, and
 * neither is worth it to draw a bicycle. An unknown key falls back rather than
 * rendering nothing, so adding a row to the catalogue can never blank a card.
 */

const ICONS = {
  walk: Footprints,
  jog: PersonStanding,
  run: Rabbit,
  bike: Bike,
  swim: Waves,
  weights: Dumbbell,
  yoga: Flower2,
  ball: Volleyball,
  football: Goal,
  rope: Repeat,
  hike: Mountain,
  dance: Music,
} as const;

export function ActivityIcon({ icon, size = 17 }: { icon: string; size?: number }) {
  const Icon = ICONS[icon as keyof typeof ICONS] ?? Zap;
  return <Icon size={size} strokeWidth={1.8} />;
}
