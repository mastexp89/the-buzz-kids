-- 068_venue_listing_types.sql  (The Buzz Kids)
-- Promote the venue/place to a first-class, filterable listing so always-on
-- ATTRACTIONS (soft play, trampoline parks, pools, play parks) live alongside
-- PROGRAMME venues (theatres, cinemas, leisure trusts, club providers) that
-- host dated events. A place can be either, or both.

-- How the place is browsed:
--   'attraction' — always-on; shown with opening hours, no events needed
--   'programmes' — hosts dated events/sessions only (theatre, club provider)
--   'both'       — open daily AND runs events (trampoline park + holiday camps)
alter table public.venues add column if not exists venue_type text
  not null default 'attraction'
  check (venue_type in ('attraction', 'programmes', 'both'));

-- Kid attributes at the PLACE level — mirrors the event fields from 066 so an
-- always-on attraction is fully filterable without needing a single event.
-- (venues.opening_hours already exists from an earlier migration.)
alter table public.venues add column if not exists age_min smallint;
alter table public.venues add column if not exists age_max smallint;
alter table public.venues add column if not exists is_free boolean not null default false;
alter table public.venues add column if not exists price_from numeric(7,2);   -- lowest £ per child; null = unknown
alter table public.venues add column if not exists price_note text;           -- human: "From £6.50 per child"
alter table public.venues add column if not exists setting text
  check (setting is null or setting in ('indoor', 'outdoor', 'both'));
alter table public.venues add column if not exists accessibility text[] not null default '{}';
alter table public.venues add column if not exists booking_required boolean not null default false;
alter table public.venues add column if not exists booking_url text;

create index if not exists venues_type_idx          on public.venues (venue_type);
create index if not exists venues_age_idx           on public.venues (age_min, age_max);
create index if not exists venues_is_free_idx        on public.venues (is_free);
create index if not exists venues_setting_idx        on public.venues (setting);
create index if not exists venues_accessibility_idx  on public.venues using gin (accessibility);

-- Categories at the PLACE level. event_genres tags dated events; this tags the
-- place itself (a soft play is "soft-play"; a farm is "farm-animals") so the
-- Places directory can filter attractions by the same category taxonomy.
create table if not exists public.venue_genres (
  venue_id  uuid not null references public.venues(id) on delete cascade,
  genre_id  uuid not null references public.genres(id) on delete cascade,
  primary key (venue_id, genre_id)
);
create index if not exists venue_genres_genre_idx on public.venue_genres (genre_id);

alter table public.venue_genres enable row level security;

drop policy if exists venue_genres_read on public.venue_genres;
create policy venue_genres_read on public.venue_genres for select
  using (exists (
    select 1 from public.venues v
    where v.id = venue_genres.venue_id
      and (v.approved = true or v.owner_id = auth.uid() or public.is_admin())
  ));

drop policy if exists venue_genres_owner_write on public.venue_genres;
create policy venue_genres_owner_write on public.venue_genres for all
  using (exists (
    select 1 from public.venues v
    where v.id = venue_genres.venue_id
      and (v.owner_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.venues v
    where v.id = venue_genres.venue_id
      and (v.owner_id = auth.uid() or public.is_admin())
  ));
