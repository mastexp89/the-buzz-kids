-- Scheduled aggregator importer: pull kids' events from regional "what's on"
-- portals (Visit Angus etc.) on a weekly cron, into the review queue.
-- Run this whole file in the Supabase SQL editor.

-- 1. The portal category feeds to sweep ---------------------------------------
create table if not exists aggregator_sources (
  id              uuid primary key default gen_random_uuid(),
  url             text not null unique,
  label           text,
  city_slug       text,          -- region this portal covers; events tag to it
  active          boolean not null default true,
  last_run_at     timestamptz,
  last_new_events int not null default 0,
  last_new_places int not null default 0,
  created_at      timestamptz not null default now()
);

-- 2. Every detail page we've already processed, so re-runs only bring NEW
--    listings (the incremental / "never re-review the same thing" part).
create table if not exists aggregator_seen (
  source_url           text primary key,   -- an event/place detail-page URL
  aggregator_source_id uuid references aggregator_sources(id) on delete set null,
  kind                 text,               -- 'event' | 'place' | 'none'
  title                text,
  first_seen           timestamptz not null default now()
);

-- Seed the Visit Angus kid-relevant category feeds (only if empty).
insert into aggregator_sources (url, label, city_slug)
select * from (values
  ('https://visitangus.com/whats-on-category/children-family/', 'Visit Angus — Children & Family', 'angus'),
  ('https://visitangus.com/whats-on-category/music-dance/',     'Visit Angus — Music & Dance',     'angus'),
  ('https://visitangus.com/whats-on-category/outdoors/',        'Visit Angus — Outdoors',          'angus'),
  ('https://visitangus.com/whats-on-category/festivals/',       'Visit Angus — Festivals',         'angus'),
  ('https://visitangus.com/whats-on-category/seasonal/',        'Visit Angus — Seasonal',          'angus'),
  ('https://visitangus.com/whats-on-category/theatre-cinema/',  'Visit Angus — Theatre & Cinema',  'angus'),
  ('https://visitangus.com/whats-on-category/markets/',         'Visit Angus — Markets',           'angus'),
  ('https://visitangus.com/whats-on-category/workshops/',       'Visit Angus — Workshops',         'angus')
) as v(url, label, city_slug)
where not exists (select 1 from aggregator_sources);

-- 3. Let events carry auto_imported_from = 'aggregator' (extend the CHECK).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%auto_imported_from%'
  loop
    execute format('alter table events drop constraint %I', c.conname);
  end loop;
end $$;

alter table events add constraint events_auto_imported_from_check
  check (auto_imported_from in ('manual_upload', 'facebook', 'instagram', 'website', 'email', 'aggregator'));

-- 4. Service-role only (all access is server-side).
alter table aggregator_sources enable row level security;
alter table aggregator_seen    enable row level security;
