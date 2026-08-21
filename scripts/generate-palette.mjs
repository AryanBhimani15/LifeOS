/**
 * Generates the tint ramp in `src/app/globals.css`, and the blue palette built
 * from it.
 *
 * ## Why this exists
 *
 * globals.css opens by saying every colour should be a token. The rose surfaces
 * never were: Home, Exams, Goals and Settings were drawn straight from a design
 * reference and landed as several hundred raw hex literals. That is the actual
 * reason the `palette` setting could not change anything — `[data-palette]` had
 * nothing to override, so picking "Forest" moved a column and nothing else.
 *
 * Hoisting those literals by hand is not work worth doing twice, and doing it
 * badly is invisible: a single mistyped hex in a wall of pink is not something
 * review catches. So it is mechanical, and it is checked — the script refuses
 * to write a file that does not round-trip back to its input exactly.
 *
 * ## What it does
 *
 * 1. Reverses any previous run, so this is idempotent and re-runnable.
 * 2. Finds every rose-family colour: hue 300–360, saturation at least 8%. That
 *    band deliberately excludes the ember reds (hue ~4–19) and the forest
 *    greens, which are shared by every palette and must not rotate.
 * 3. Replaces each with a `--rose-NNN` token, numbered light to dark, and emits
 *    the ramp with the original values — so rose and forest do not move.
 * 4. Emits the same ramp rotated to `BLUE_HUE`, saturation and lightness
 *    untouched, so every contrast pairing the rose design worked out survives.
 *
 * Usage: `npm run palette`
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../src/app/globals.css", import.meta.url);
const BLUE_HUE = 212;
/** The hue the product was drawn at. Only the banner rotation needs it. */
const ROSE_HUE = 342;

/** Where the generated section starts. Everything from here down is rewritten. */
const MARKER = "/* === generated: tint ramp — see scripts/generate-palette.mjs === */";

/** Rules that sample every palette at once, and so keep their literals. */
const VERBATIM = /settings-swatch/;

const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;

function toRgb(lit) {
  let m;
  if ((m = /^#([0-9a-f]{8})$/i.exec(lit)))
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[1].slice(6, 8)];
  if ((m = /^#([0-9a-f]{6})$/i.exec(lit)))
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), null];
  if ((m = /^#([0-9a-f]{3})$/i.exec(lit)))
    return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), null];
  if ((m = /^rgba?\(([^)]*)\)$/i.exec(lit))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    // Anything with a non-integer channel is a function call, not a colour.
    if (p.length < 3 || p.slice(0, 3).some((v) => !/^\d+$/.test(v))) return null;
    return [+p[0], +p[1], +p[2], p[3] ?? null];
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let v;
  if (h < 60) v = [c, x, 0]; else if (h < 120) v = [x, c, 0];
  else if (h < 180) v = [0, c, x]; else if (h < 240) v = [0, x, c];
  else if (h < 300) v = [x, 0, c]; else v = [c, 0, x];
  return v.map((n) => Math.round((n + m) * 255));
}

const isRose = ([h, s]) => h >= 300 && h < 360 && s >= 0.08;

function rotate(lit, hue) {
  const rgb = toRgb(lit);
  const [, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslToRgb(hue, s, l);
  if (/^rgba?\(/i.test(lit))
    return rgb[3] === null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${rgb[3]})`;
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return rgb[3] === null ? hex : hex + rgb[3];
}

/**
 * Undoes a previous run.
 *
 * The ramp block is its own token-to-literal map, so a re-run does not need the
 * original file — it reads the values back out of what it wrote last time.
 */
function ungenerate(text) {
  const cut = text.indexOf(MARKER);
  if (cut < 0) return text;
  // First definition only. The blue block redefines the whole ramp, and taking
  // the last would reverse the file into blue and then find nothing rose left
  // to tokenise — which is exactly as quiet, and as wrong, as it sounds.
  const map = new Map();
  for (const m of text.slice(cut).matchAll(/(--rose-\d{3}):\s*([^;]+);/g))
    if (!map.has(m[1])) map.set(m[1], m[2].trim());
  return text
    .slice(0, cut)
    .replace(/var\((--rose-\d{3})\)/g, (whole, name) => {
      const literal = map.get(name);
      if (!literal) throw new Error(`${name} is used but the ramp does not define it`);
      return literal;
    })
    .trimEnd() + "\n";
}

const previous = readFileSync(SRC, "utf8");
const source = ungenerate(previous);
if (source.includes("--rose-")) throw new Error("rose tokens survived un-generation");

const found = new Map();
for (const match of source.match(COLOR) ?? []) {
  const lit = match.toLowerCase();
  if (found.has(lit)) continue;
  const rgb = toRgb(lit);
  if (!rgb) continue;
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (isRose(hsl)) found.set(lit, hsl);
}

// Lightest first, so the numbering reads as a ramp. Ties break on the literal
// itself, or the numbering would shuffle between runs.
const ordered = [...found.entries()].sort((a, b) => b[1][2] - a[1][2] || a[0].localeCompare(b[0]));
const names = new Map(ordered.map(([lit], i) => [lit, `--rose-${String(i + 1).padStart(3, "0")}`]));

const css = source
  .split("\n")
  .map((line) =>
    VERBATIM.test(line)
      ? line
      : line.replace(COLOR, (m) => (names.has(m.toLowerCase()) ? `var(${names.get(m.toLowerCase())})` : m)),
  )
  .join("\n");

// The whole point of doing this mechanically is that it can be proved. A token
// swap that changed one colour would be almost impossible to spot by eye.
{
  const literals = new Map([...names].map(([lit, name]) => [name, lit]));
  const back = css.replace(/var\((--rose-\d{3})\)/g, (whole, name) => literals.get(name) ?? whole);
  const fold = (t) => t.replace(/#[0-9a-fA-F]+/g, (h) => h.toLowerCase());
  if (fold(back) !== fold(source)) throw new Error("round-trip mismatch — refusing to write");
}

/** Packs the ramp a few declarations to a line; 356 single-line tokens is noise. */
function ramp(pick) {
  const decls = ordered.map(([lit]) => `${names.get(lit)}: ${pick(lit)};`);
  const lines = [];
  for (let i = 0; i < decls.length; i += 4) lines.push("  " + decls.slice(i, i + 4).join(" "));
  return lines.join("\n");
}

/** Every custom property in `selector`'s own blocks whose value reads the ramp. */
function derived(selector) {
  const out = [];
  const needle = selector + " {";
  for (let at = css.indexOf(needle); at >= 0; at = css.indexOf(needle, at + 1)) {
    // Must begin its own rule: `.dark-mode [data-palette="rose"]` is a different
    // block from `[data-palette="rose"]` and must not answer for it.
    if (at !== 0 && css[at - 1] !== "\n") continue;
    const open = css.indexOf("{", at);
    let depth = 0, end = open;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) { end = i; break; }
    }
    for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;{}]*var\(--rose-[^;{}]*)/g))
      out.push(`  ${m[1]}: ${m[2].trim()};`);
  }
  return out;
}

/** Last declaration wins, where it was declared. :root and the rose block overlap. */
function decls(...groups) {
  const merged = new Map();
  for (const line of groups.flat()) merged.set(line.split(":")[0].trim(), line);
  return [...merged.values()].join("\n");
}

const out = `${css.trimEnd()}

${MARKER}
/* ---------------------------------------------------------------------------
   The tint ramp

   Every rose-family colour in this file, hoisted out of the rules that used to
   hard-code it and ordered light to dark. The values are unchanged, so rose and
   forest render exactly as they did.

   Generated. Edit the rules above, not this block, then \`npm run palette\`.
--------------------------------------------------------------------------- */
:root {
${ramp((lit) => lit)}
}

/* ---------------------------------------------------------------------------
   Blue

   The same ramp rotated to ${BLUE_HUE}°, saturation and lightness left alone.

   The ramp is only half of it. Tokens like --pink and --surface-card are
   declared on :root and on .dark-mode, both of which sit *above* the palette
   element — so they were already resolved against rose by the time the ramp
   came into scope. Re-declaring them here, verbatim, resolves them again
   against the ramp above.
--------------------------------------------------------------------------- */
[data-palette="blue"] {
${ramp((lit) => rotate(lit, BLUE_HUE))}

${decls(derived(":root"), derived('[data-palette="rose"]'))}
}

.dark-mode [data-palette="blue"] {
${decls(derived(".dark-mode"), derived('.dark-mode [data-palette="rose"]'))}
}

/* The hero art is a pink sakura photograph, which no token can reach, so the
   blue palette turns the bitmap by the same angle. It moves onto its own layer
   because a filter on .home-hero would take the headline and the overlay with
   it. */
[data-palette="blue"] .home-hero { background-image: none; }
[data-palette="blue"] .home-hero::before {
  content: ""; position: absolute; inset: 0;
  background: url("/images/home-sakura-banner.png") center / cover no-repeat;
  filter: hue-rotate(${BLUE_HUE - ROSE_HUE}deg);
}
`;

// Re-running must be a no-op. That is the property that makes it safe to run
// after any edit to the rules above, and the one the reversal bug broke.
if (previous.includes(MARKER) && out !== previous)
  throw new Error("not idempotent — a re-run would change the file");

writeFileSync(SRC, out);
console.log(`globals.css: ${ordered.length} rose literals tokenised, blue palette written`);
