-- ============================================================
-- The Buzz Guide: extend page_views with click-through tracking.
-- Adds a `kind` column so the same table can store both passive views
-- and active clicks (phone, website, maps, FB, IG, etc.).
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table page_views
  add column if not exists kind text not null default 'view';

-- Common click kinds:
--   view, click_phone, click_website, click_maps, click_email,
--   click_facebook, click_instagram, click_twitter, click_tiktok,
--   click_youtube, click_spotify, click_bandcamp, click_share, click_ticket

create index if not exists page_views_kind_idx on page_views (kind, viewed_at desc);

-- ============================================================
-- DONE.
-- ============================================================
