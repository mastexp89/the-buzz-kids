-- =====================================================================
-- Migration 005: Self-serve promotions
-- 4 gig-level promos + 1 venue-level promo. Each is "active" while its
-- *_until timestamp is in the future. Free for now (no Stripe wiring yet).
-- =====================================================================

alter table public.events
  add column if not exists featured_until        timestamptz,  -- pinned to top of /dundee
  add column if not exists highlighted_until     timestamptz,  -- yellow border in listings
  add column if not exists genre_takeover_until  timestamptz,  -- jumps to top when genre filter active
  add column if not exists weekend_boost_until   timestamptz;  -- "WEEKEND HIGHLIGHT" badge

alter table public.venues
  add column if not exists spotlight_until       timestamptz;  -- featured venues carousel on home

create index if not exists events_featured_idx        on public.events (featured_until)        where featured_until        is not null;
create index if not exists events_highlighted_idx     on public.events (highlighted_until)     where highlighted_until     is not null;
create index if not exists events_genre_takeover_idx  on public.events (genre_takeover_until)  where genre_takeover_until  is not null;
create index if not exists events_weekend_boost_idx   on public.events (weekend_boost_until)   where weekend_boost_until   is not null;
create index if not exists venues_spotlight_idx       on public.venues (spotlight_until)       where spotlight_until       is not null;
