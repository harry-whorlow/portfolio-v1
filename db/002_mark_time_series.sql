-- Run once in the Neon SQL editor (on the main branch, and on any dev branch).
-- One row per hello, so hellos can be charted over time. "mark-ledger".count stays as the fast running total.

CREATE TABLE IF NOT EXISTS "mark-time-series" (
  "id"      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "mark-id" uuid NOT NULL REFERENCES "mark-ledger" ("id") ON DELETE CASCADE,
  "said-at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mark-time-series_mark-id_said-at_idx" ON "mark-time-series" ("mark-id", "said-at");
