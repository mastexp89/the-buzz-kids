-- ============================================================
-- The Buzz Guide: Page-view analytics for venues, artists and events.
-- One row per page view (server-side tracked, bots filtered out).
-- Admin dashboard aggregates over windows. Owners see their own.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  venue_id  uuid references venues(id)  on delete cascade,
  artist_id uuid references artists(id) on delete cascade,
  event_id  uuid references events(id)  on delete cascade,
  viewed_at timestamptz not null default now(),
  -- Optional context (might add later: country, referer, mobile/desktop)
  source text
);

-- Lookups by entity + time
create index if not exists page_views_venue_idx
  on page_views (venue_id, viewed_at desc) where venue_id is not null;
create index if not exists page_views_artist_idx
  on page_views (artist_id, viewed_at desc) where artist_id is not null;
create index if not exists page_views_event_idx
  on page_views (event_id, viewed_at desc) where event_id is not null;
-- Time-only scans (admin "total views in last 7d")
create index if not exists page_views_at_idx on page_views (viewed_at desc);

alter table page_views enable row level security;

-- Anyone can insert (server tracks via service role anyway, but if any client
-- ever fires a tracking event we want the anon role to be able to log it).
drop policy if exists "page_views: insert" on page_views;
create policy "page_views: insert"
  on page_views for insert
  to anon, authenticated
  with check (true);

-- Read: admin only for the global view. Owners can read their own venue/artist
-- views via dashboard server actions running with service role.
drop policy if exists "page_views: admin read" on page_views;
create policy "page_views: admin read"
  on page_views for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================
