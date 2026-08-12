import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";

/**
 * The type system.
 *
 * Loaded through `next/font` rather than an `@import` in the stylesheet. An
 * @import is a render-blocking request to a third party that has to resolve
 * before a single character is painted, and then reflows the page when it
 * lands. These are self-hosted at build time with a matched fallback metric, so
 * text is the right size on the first frame.
 *
 * Three faces, each with a job:
 *
 *  - Instrument Serif for anything large enough to be read as a statement — the
 *    greeting, the welcome. It has genuine character at display sizes, where
 *    the previous Playfair went thin and generic.
 *  - Instrument Sans for the interface. Designed alongside the serif, so the
 *    pairing is deliberate rather than two fonts that happen to coexist.
 *  - JetBrains Mono wherever digits need to line up — calorie totals, weights,
 *    durations, timestamps.
 */

export const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

/** Applied to <html> so every rule can reach the families through variables. */
export const fontVariables = `${sans.variable} ${display.variable} ${mono.variable}`;
