-- Attractions the aggregator finds (not dated events) — captured quietly for
-- review, NO per-place email (that flooded the inbox). Reviewed in the
-- aggregator admin page: add the good ones as venues, dismiss the rest.
-- Run this whole file in the Supabase SQL editor.

create table if not exists aggregator_places (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  norm_name  text not null,          -- normalised name, for dedupe
  location   text,
  website    text,
  source_url text,
  city_slug  text,
  status     text not null default 'new',   -- 'new' | 'dismissed'
  found_at   timestamptz not null default now(),
  unique (norm_name)                  -- one row per place, across all runs
);

create index if not exists aggregator_places_status on aggregator_places (status, found_at desc);

alter table aggregator_places enable row level security;
