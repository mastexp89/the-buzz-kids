-- ============================================================
-- 082: Website event auto-scrape
--
-- The Buzz Kids has almost no Facebook URLs (the FB cron is idle here)
-- but 900+ venues have a real website. This adds the plumbing for a
-- cron that fetches each venue's site, AI-extracts kids' events, and
-- drops them into the review queue (events.status = 'pending').
--
--   • venues.last_website_scrape — cursor + cooldown anchor, mirrors
--     last_facebook_scrape. NULLS FIRST ordering = never-scraped first.
--   • website_scrape_venue_runs — per-venue run log, mirrors
--     fb_scrape_venue_runs (058), so /admin/cron-runs can show why a
--     run produced 0 events (site down, no event signal, AI found
--     nothing, or dedupe caught everything).
--
-- Additive + idempotent. Safe to re-run. Run once in Supabase SQL editor.
-- ============================================================

-- 1. Per-venue cursor / cooldown anchor -----------------------------
alter table public.venues
  add column if not exists last_website_scrape timestamptz;

-- Partial-friendly ordering index (NULLS FIRST in the query gives
-- never-scraped venues priority).
create index if not exists venues_last_website_scrape_idx
  on public.venues (last_website_scrape);

-- 2. Per-venue run log ----------------------------------------------
create table if not exists public.website_scrape_venue_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  venue_id uuid references public.venues(id) on delete set null,
  venue_name text not null,
  city_slug text,
  website text,
  -- Counts from the cron's per-venue summary.
  pages_fetched int not null default 0,
  pages_extracted int not null default 0,
  events_created int not null default 0,
  events_skipped int not null default 0,
  error text,
  forced boolean not null default false
);

create index if not exists website_scrape_venue_runs_ran_at_idx
  on public.website_scrape_venue_runs(ran_at desc);
create index if not exists website_scrape_venue_runs_venue_idx
  on public.website_scrape_venue_runs(venue_id);
create index if not exists website_scrape_venue_runs_errors_idx
  on public.website_scrape_venue_runs(ran_at desc)
  where error is not null;

alter table public.website_scrape_venue_runs enable row level security;

drop policy if exists "website_scrape_venue_runs_admin_read" on public.website_scrape_venue_runs;
create policy "website_scrape_venue_runs_admin_read"
  on public.website_scrape_venue_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

comment on table public.website_scrape_venue_runs is
  'Per-venue run log for the website event scrape cron. One row per (venue, cron iteration). Mirrors fb_scrape_venue_runs.';

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
