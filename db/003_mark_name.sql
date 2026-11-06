-- Run once in the Neon SQL editor (on the main branch, and on any dev branch).
-- An optional name left with each hello. It lives on the per-hello row, since one city collects many hellos.
-- "display" is flipped by hand to show a name on the globe; a name is never sent to the site until it's true.

ALTER TABLE "mark-time-series"
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "display" boolean NOT NULL DEFAULT false;

-- to show someone:  UPDATE "mark-time-series" SET display = true WHERE name = 'Their Name';
