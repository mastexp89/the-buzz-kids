-- Track when each venue was last scraped via the FB cron job, so the
-- scheduled task can rotate through stalest venues first.
alter table public.venues
  add column if not exists last_facebook_scrape timestamptz;

create index if not exists venues_last_fb_scrape_idx
  on public.venues (last_facebook_scrape nulls first)
  where facebook is not null;
