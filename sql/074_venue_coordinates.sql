-- ============================================================
-- The Buzz Kids: venue coordinates.
-- The app reads venues.latitude / venues.longitude in many places
-- (the map page, "near me" distance sorting, Discover, Enrich, the
-- Add-venue form) but this fork's database never had the columns —
-- so every auto-import insert was failing with PGRST204 and being
-- silently skipped. Add them.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;

-- Helps the map bounding-box / nearest-place queries.
create index if not exists venues_lat_lng_idx
  on public.venues (latitude, longitude);

-- Nudge PostgREST to refresh its schema cache immediately so inserts
-- referencing the new columns work without waiting for the next reload.
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
