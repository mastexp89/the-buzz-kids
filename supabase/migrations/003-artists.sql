-- =====================================================================
-- Migration 003: Artist tagging
-- - Each artist gets a public profile page at /artists/[slug]
-- - Venues tag artists on their gigs; tagged gigs auto-show on artist pages
-- - For now, anyone can be tagged (venues are trusted/paying);
--   artist claim/edit flow comes later.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- Artists
create table if not exists public.artists (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  bio         text,
  image_url   text,
  website     text,
  instagram   text,
  twitter     text,
  facebook    text,
  spotify     text,
  bandcamp    text,
  youtube     text,
  city_id     uuid references public.cities(id),
  claimed_by  uuid references public.profiles(id),  -- artist account that has claimed it (null = unclaimed)
  approved    boolean not null default true,        -- v1: auto-approved since venues are trusted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists artists_name_idx on public.artists (name);
create index if not exists artists_city_idx on public.artists (city_id);

-- Event ↔ artist join
create table if not exists public.event_artists (
  event_id   uuid not null references public.events(id) on delete cascade,
  artist_id  uuid not null references public.artists(id) on delete cascade,
  primary key (event_id, artist_id)
);
create index if not exists event_artists_artist_idx on public.event_artists (artist_id);

-- Updated-at trigger for artists (reuses existing function)
drop trigger if exists artists_set_updated_at on public.artists;
create trigger artists_set_updated_at before update on public.artists
  for each row execute function public.set_updated_at();

-- Row-level security
alter table public.artists       enable row level security;
alter table public.event_artists enable row level security;

-- Artists: world-readable for approved rows; claimer can update own; admin can do anything
drop policy if exists artists_public_read on public.artists;
create policy artists_public_read on public.artists for select
  using (approved = true or claimed_by = auth.uid() or public.is_admin());

drop policy if exists artists_authenticated_insert on public.artists;
create policy artists_authenticated_insert on public.artists for insert
  with check (auth.role() = 'authenticated');

drop policy if exists artists_self_or_admin_update on public.artists;
create policy artists_self_or_admin_update on public.artists for update
  using (claimed_by = auth.uid() or public.is_admin())
  with check (claimed_by = auth.uid() or public.is_admin());

drop policy if exists artists_admin_delete on public.artists;
create policy artists_admin_delete on public.artists for delete
  using (public.is_admin());

-- event_artists: read public for approved-venue events; venue owner can write tags on their events
drop policy if exists event_artists_read on public.event_artists;
create policy event_artists_read on public.event_artists for select
  using (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_artists.event_id
        and (v.approved = true or v.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists event_artists_owner_write on public.event_artists;
create policy event_artists_owner_write on public.event_artists for all
  using (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_artists.event_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_artists.event_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );
