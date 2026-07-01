-- ============================================================
-- 083: Dog-friendly flag on venues
--
-- Adds a boolean the places directory can filter on. Populated from the
-- curated FB "things to do" list's 🐶 tags (backfilled by a script that
-- matches venue names), and settable per-venue in the dashboard/admin.
--
-- Additive + idempotent. Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists dog_friendly boolean not null default false;

-- Partial index so "dog friendly only" filtering stays fast.
create index if not exists venues_dog_friendly_idx
  on public.venues (dog_friendly) where dog_friendly = true;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
