-- ============================================================
-- The Buzz Kids: let visitors flag an offer that's ended.
-- A "Not on anymore?" button increments this counter so admins can
-- spot deals worth re-checking. No new table needed — just a tally.
-- Run once in Supabase SQL editor (after 077). Safe to re-run.
-- ============================================================

alter table public.offers
  add column if not exists reports          int not null default 0,
  add column if not exists last_reported_at timestamptz;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
