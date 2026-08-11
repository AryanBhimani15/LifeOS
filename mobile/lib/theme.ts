import { useColorScheme } from "react-native";

/**
 * Design tokens, matching the web app's palette so the two feel like one product.
 *
 * A capture app is used in a doorway, at night, one-handed — so contrast and hit
 * targets matter more than decoration. Everything below is sized for a thumb.
 */

/** Every palette has the same keys; `as const` on the objects would make each
 *  colour its own literal type and stop dark from matching light. */
export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
  success: string;
}

const light: Palette = {
  bg: "#FAFAF9",
  surface: "#FFFFFF",
  surfaceAlt: "#F4F4F2",
  border: "#E7E5E4",
  text: "#1C1917",
  textMuted: "#57534E",
  textFaint: "#A8A29E",
  accent: "#5B58E8",
  accentSoft: "#EEEDFF",
  danger: "#D0463B",
  dangerSoft: "#FDECEA",
  success: "#10B981",
};

const dark: Palette = {
  bg: "#0C0A09",
  surface: "#191C20",
  surfaceAlt: "#16191D",
  border: "#2A2D33",
  text: "#FAFAF9",
  textMuted: "#B5B9C0",
  textFaint: "#8B8E95",
  accent: "#716DFF",
  accentSoft: "#22243A",
  danger: "#F87171",
  dangerSoft: "#2A1A1A",
  success: "#34D399",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const type = {
  display: { fontSize: 30, fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "600" },
  caption: { fontSize: 12.5, fontWeight: "400" },
} as const;
