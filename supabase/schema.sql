-- =====================================================================
-- The Buzz Guide — Supabase schema
-- =====================================================================
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- It creates the tables, indexes, RLS policies, and seed data needed.
-- =====================================================================

-- 1. EXTENSIONS ------------------------------------------------------
create extension if not exists "uuid-ossp";

-- 2. TABLES ---------------------------------------------------------

-- Cities the app supports. Start with Dundee, add others later.
create table if not exists public.cities (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Music genres.
create table if not exists public.genres (
  id    uuid primary key default uuid_generate_v4(),
  name  text not null unique,
  slug  text not null unique
);

-- One profile row per auth user. Created automatically by trigger.
-- role: 'user' | 'venue_owner' | 'admin'
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  role          text not null default 'venue_owner' check (role in ('user','venue_owner','admin')),
  created_at    timestamptz not null default now()
);

-- Venues are pubs/clubs/etc. that host live music.
create table if not exists public.venues (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  city_id       uuid not null references public.cities(id),
  name          text not null,
  slug          text not null unique,
  description   text,
  address       text,
  postcode      text,
  phone         text,
  website       text,
  email         text,
  image_url     text,
  approved      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists venues_city_idx on public.venues (city_id);
create index if not exists venues_owner_idx on public.venues (owner_id);
create index if not exists venues_approved_idx on public.venues (approved);

-- Events are gigs at a venue.
create table if not exists public.events (
  id            uuid primary key default uuid_generate_v4(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  title         text not null,
  description   text,
  start_time    timestamptz not null,
  end_time      timestamptz,
  cover_charge  text,                       -- "Free", "£5", "£10 / £8 advance"
  ticket_url    text,
  image_url     text,
  cancelled     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists events_venue_idx on public.events (venue_id);
create index if not exists events_start_idx on public.events (start_time);

-- Event ↔ genre many-to-many.
create table if not exists public.event_genres (
  event_id  uuid not null references public.events(id) on delete cascade,
  genre_id  uuid not null references public.genres(id) on delete cascade,
  primary key (event_id, genre_id)
);
create index if not exists event_genres_genre_idx on public.event_genres (genre_id);

-- 3. AUTO-CREATE PROFILE ON SIGNUP -----------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. UPDATED_AT TRIGGER -----------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists venues_set_updated_at on public.venues;
create trigger venues_set_updated_at before update on public.venues
  for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- 5. ROW-LEVEL SECURITY -----------------------------------------------
alter table public.cities       enable row level security;
alter table public.genres       enable row level security;
alter table public.profiles     enable row level security;
alter table public.venues       enable row level security;
alter table public.events       enable row level security;
alter table public.event_genres enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean as $$
  select exists(
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer;

-- Cities & genres: world-readable, admin-writable
drop policy if exists cities_read on public.cities;
create policy cities_read on public.cities for select using (true);
drop policy if exists cities_admin_write on public.cities;
create policy cities_admin_write on public.cities for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists genres_read on public.genres;
create policy genres_read on public.genres for select using (true);
drop policy if exists genres_admin_write on public.genres;
create policy genres_admin_write on public.genres for all using (public.is_admin()) with check (public.is_admin());

-- Profiles: user can read/update own, admins can read/update all
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select
  using (auth.uid() = id or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert
  with check (auth.uid() = id);

-- Venues: anyone can read APPROVED venues. Owners read their own pending too.
-- Owners insert/update their own. Admins do anything.
drop policy if exists venues_public_read on public.venues;
create policy venues_public_read on public.venues for select
  using (approved = true or owner_id = auth.uid() or public.is_admin());

drop policy if exists venues_owner_insert on public.venues;
create policy venues_owner_insert on public.venues for insert
  with check (owner_id = auth.uid());

drop policy if exists venues_owner_update on public.venues;
create policy venues_owner_update on public.venues for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists venues_admin_delete on public.venues;
create policy venues_admin_delete on public.venues for delete
  using (public.is_admin() or owner_id = auth.uid());

-- Events: public read for events at approved venues. Owners read/write own.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events for select
  using (
    exists (
      select 1 from public.venues v
      where v.id = events.venue_id
        and (v.approved = true or v.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists events_owner_write on public.events;
create policy events_owner_write on public.events for all
  using (
    exists (
      select 1 from public.venues v
      where v.id = events.venue_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.venues v
      where v.id = events.venue_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );

-- event_genres: same rules as events (joined via event)
drop policy if exists event_genres_read on public.event_genres;
create policy event_genres_read on public.event_genres for select
  using (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_genres.event_id
        and (v.approved = true or v.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists event_genres_owner_write on public.event_genres;
create policy event_genres_owner_write on public.event_genres for all
  using (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_genres.event_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.events e
      join public.venues v on v.id = e.venue_id
      where e.id = event_genres.event_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );

-- 6. SEED DATA --------------------------------------------------------
insert into public.cities (name, slug) values ('Dundee', 'dundee')
  on conflict (slug) do nothing;

-- Add a few more cities, inactive for now — flip active=true when ready.
insert into public.cities (name, slug, active) values
  ('Edinburgh', 'edinburgh', false),
  ('Glasgow', 'glasgow', false),
  ('Aberdeen', 'aberdeen', false),
  ('Perth', 'perth', false),
  ('Stirling', 'stirling', false)
  on conflict (slug) do nothing;

insert into public.genres (name, slug) values
  ('Rock', 'rock'),
  ('Indie', 'indie'),
  ('Folk', 'folk'),
  ('Traditional Scottish', 'trad'),
  ('Acoustic', 'acoustic'),
  ('Singer-songwriter', 'singer-songwriter'),
  ('Jazz', 'jazz'),
  ('Blues', 'blues'),
  ('Country / Americana', 'country'),
  ('Punk', 'punk'),
  ('Metal', 'metal'),
  ('Electronic / DJ', 'electronic'),
  ('Hip-Hop', 'hip-hop'),
  ('Pop', 'pop'),
  ('Funk / Soul', 'funk'),
  ('Open Mic', 'open-mic'),
  ('Cover bands', 'covers'),
  ('Tribute acts', 'tribute'),
  ('Classical', 'classical'),
  ('Reggae / Ska', 'reggae'),
  ('World', 'world')
  on conflict (slug) do nothing;
