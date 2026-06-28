-- 000_schema_drift_patch.sql
-- Columns the original Buzz Guide database had but that were never committed
-- as migrations (added ad-hoc via the Supabase dashboard during development).
-- Later migrations reference them, so a fresh install from the migration files
-- alone fails without them. This runs FIRST (000) so the columns exist before
-- any 0xx migration touches them. All `if not exists`, so it's a harmless no-op
-- if a later migration also defines the column.

-- venues.auto_imported — referenced by 027_venues_owner_id_nullable and the
-- admin "Unclaimed" badge logic (isAutoImported). A boolean flag marking a
-- venue that was created by the discovery/scrape pipeline rather than claimed
-- by a real owner.
alter table public.venues
  add column if not exists auto_imported boolean not null default false;
