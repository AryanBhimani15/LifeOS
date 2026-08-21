# Palettes

The product ships three tints: **Blush** (rose), **Azure** (blue) and **Forest**.
Which one an account wears is a stored setting — `UserSettings.palette` — read
once on the server in `src/app/(app)/layout.tsx` and rendered onto the app shell
as `[data-palette]`, so the first paint is already the right colour.

## The palette is seeded, not derived

Setup asks for your sex because the BMR calculation needs it. It used to also
use that answer as the theme picker: the layout computed

```ts
palette={profile.sex === "FEMALE" ? "rose" : "forest"}
```

on every render. Two things were wrong with that. The colour of the product
could only be changed by editing a health input — there was no way to keep the
green and correct your weight — and the onboarding flow retinted live on the sex
question, which made a health input look like a theme question mid-flow.

So the answer now seeds the column and then lets go of it. `completeOnboarding`
writes `rose` for `FEMALE` and `blue` for everyone else, **once**, on the first
completion. From the next screen onwards the palette is an ordinary setting and
Settings has the last word — re-running setup and answering differently will not
repaint an account.

Seeding on first completion left every account that finished setup *before* the
change sitting on the column default — pink, whatever answer it had given. They
were backfilled once, in `20260819000000_backfill_palette_from_sex`, which is
only safe because the palette had no visible effect until the tint ramp landed
in the same change: every stored value was a default nobody had ever seen, not a
preference. That migration is not a pattern to copy now that the setting works.

The tests that hold this line:

- `tests/settings.test.ts` — "the palette is a choice, not a guess": two accounts
  with the same stored palette must render identically whatever their profiles
  say. This is the test that stops the *derivation* coming back.
- `tests/workout-plan.test.ts` — "the palette it starts you on": the seed writes
  on a first finish, and never overrules a choice made in Settings.

## The tint ramp

`globals.css` says at the top that every colour should be a token. The rose
surfaces were not: Home, Exams, Goals and Settings came from a design reference
and landed as **356 raw hex literals**. That is the real reason the palette
setting did nothing for so long — `[data-palette]` had nothing to override, so
picking "Forest" changed a database column and not one pixel.

`scripts/generate-palette.mjs` fixes that mechanically:

```
npm run palette
```

It hoists every rose-family colour into a `--rose-NNN` token, ordered light to
dark, emits the ramp with the **original values** — so rose and forest do not
move — and then emits the same ramp rotated to 212°, saturation and lightness
untouched, as `[data-palette="blue"]`.

Run it after any edit to the rules above the generated marker. It is idempotent:
it reverses its own previous output first, reading the token values back out of
the ramp it wrote last time, and refuses to write a file that does not round-trip
to its input exactly.

### What the script deliberately does not touch

- **Hue 300–360 only, at 8% saturation or more.** That band excludes the ember
  reds (hue ~4–19) and the forest greens, which every palette shares.
- **`.settings-swatch`.** A swatch is a sample *of* a palette, not a surface
  wearing one, so each option has to show its own colour whichever palette is
  active. Add a `.settings-swatch.is-<name>` rule by hand for a new palette.

### Things a token cannot reach

- **The Home hero art** is a pink sakura photograph. The blue palette re-lays it
  on its own `::before` and rotates the bitmap by the same angle — a filter on
  `.home-hero` itself would take the headline and the overlay with it.
- **Portalled UI.** `ActivitySelector` renders its menu into `document.body` to
  escape a stacking context, which also escapes `[data-palette]`. It copies the
  attribute across with its placement coordinates. Anything else that portals out
  of the shell has to do the same.

## Adding a palette

1. Add the name to `palette` in `src/lib/validation/settings.ts`. The stored
   column is a plain string; `getPalette` validates it and falls back to `rose`,
   so removing a palette later is safe.
2. Add an entry to `PALETTES` in `src/components/settings/SettingsForm.tsx` and a
   `.settings-swatch.is-<name>` rule in `globals.css`.
3. If it is another rotation of the rose design, add it to the generator beside
   the blue block and re-run `npm run palette`. If it is a genuinely different
   design, write the block by hand above the generated marker.
