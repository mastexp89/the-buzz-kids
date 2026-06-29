-- ============================================================
-- The Buzz Kids: two more columns the app reads/writes that this
-- fork's database never had — saving a venue in the dashboard hit
-- "Could not find the 'opening_hours_json' column" (PGRST204).
--   opening_hours_json — structured per-day open/close times
--   photo_refs         — Google photo references queued for download
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists opening_hours_json jsonb,
  add column if not exists photo_refs text[];

-- Refresh PostgREST's schema cache so the new columns are usable at once.
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
