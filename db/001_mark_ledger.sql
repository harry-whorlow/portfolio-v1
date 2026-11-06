-- Run once in the Neon SQL editor (on the main branch, and on any dev branch).
-- The globe needs each city's coordinates to aim the comet, and one row per city so hellos can be counted with
-- an upsert. Assumes the table is still empty: NOT NULL columns can't be added to existing rows without a default.

-- the table started out as "leave-your-mark"; this is a no-op once it's been renamed
ALTER TABLE IF EXISTS "leave-your-mark" RENAME TO "mark-ledger";

ALTER TABLE "mark-ledger"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "country" SET NOT NULL,
  ALTER COLUMN "city" SET NOT NULL,
  ALTER COLUMN "count" SET NOT NULL,
  ALTER COLUMN "count" SET DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lat" double precision NOT NULL,
  ADD COLUMN IF NOT EXISTS "lon" double precision NOT NULL,
  ADD CONSTRAINT "mark-ledger_country_city_key" UNIQUE ("country", "city");
