-- ============================================================
-- 084: Venue "report an issue" counter + Google rating
--
-- 1. Let parents flag a place that's closed / moved / has wrong details.
--    Mirrors the offers "Not on anymore?" pattern — a counter + last note,
--    no new table. Admins spot flagged places via the count.
-- 2. Store the Google star rating + review count so the venue page can show
--    a trust signal (★ 4.6 · 312) and link out to Google reviews.
--
-- Additive + idempotent. Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists reports          int not null default 0,
  add column if not exists last_reported_at timestamptz,
  add column if not exists report_note      text,
  add column if not exists google_rating       numeric(2,1),
  add column if not exists google_rating_count int;

-- Find flagged places fast in admin.
create index if not exists venues_reports_idx on public.venues (reports) where reports > 0;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
