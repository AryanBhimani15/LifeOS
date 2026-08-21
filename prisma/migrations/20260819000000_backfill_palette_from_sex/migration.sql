-- Backfills the palette for accounts that predate it being seeded at setup.
--
-- Setup now writes `rose` for a FEMALE profile and `blue` for everyone else, but
-- only on a first completion — so every account that finished setup before that
-- kept the column default and stayed pink regardless of the answer it gave.
--
-- Restricted to rows still holding the default. That is a weaker guard than it
-- looks, because `rose` is also a choice someone could have made, and the two
-- are the same bytes. It is safe here only because the palette had no visible
-- effect until the tint ramp landed in the same change: every stored value is a
-- default that was never rendered, not a preference. Do not copy this pattern
-- once people have actually picked a colour.
UPDATE "user_settings" AS s
SET "palette" = 'blue'
FROM "fitness_profiles" AS f
WHERE f."userId" = s."userId"
  AND f."completedAt" IS NOT NULL
  AND f."sex" <> 'FEMALE'
  AND s."palette" = 'rose';
