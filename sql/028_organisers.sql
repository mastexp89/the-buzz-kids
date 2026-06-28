-- ============================================================
-- 028: Event organisers — separate entity from artists.
--
-- An organiser is a promoter / event company that runs gigs across
-- multiple venues. They have their own public profile page (bio,
-- socials, image, website) and can claim ownership of events they
-- promote. Same approval / review model as venues + artists.
--
-- Why a separate table from `artists`:
--   - Different mental model (organiser != performer)
--   - Different URL pattern (/organisers/[slug] vs /artists/[slug])
--   - Future fields might diverge (touring schedules, white-label
--     festival pages, etc.)
-- ============================================================

create table if not exists public.organisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (length(slug) between 1 and 120),
  bio text,
  image_url text,
  website text,
  instagram text,
  facebook text,
  twitter text,
  tiktok text,
  spotify text,
  bandcamp text,
  youtube text,
  email text,
  -- Owner: the user account that manages this profile. Nullable so the
  -- profile can exist before being claimed (admin-created etc).
  claimed_by uuid references auth.users(id) on delete set null,
  -- Same approval model as venues / artists: false = pending review,
  -- true = visible publicly + edits go straight to public page.
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organisers_claimed_by_idx
  on public.organisers (claimed_by) where claimed_by is not null;
create index if not exists organisers_slug_idx
  on public.organisers (slug);
create index if not exists organisers_approved_idx
  on public.organisers (approved) where approved = true;

-- updated_at auto-bump via trigger. Inline-define the helper function so
-- this migration has no external dependency.
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organisers_updated_at on public.organisers;
create trigger organisers_updated_at
  before update on public.organisers
  for each row execute function public.update_updated_at_column();

-- Junction table linking an organiser to an event they organise. Many
-- organisers can co-promote one event; one organiser can run many events.
create table if not exists public.event_organisers (
  event_id uuid not null references public.events(id) on delete cascade,
  organiser_id uuid not null references public.organisers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, organiser_id)
);

create index if not exists event_organisers_event_idx on public.event_organisers (event_id);
create index if not exists event_organisers_organiser_idx on public.event_organisers (organiser_id);

-- ============================================================
-- RLS — public read for approved organisers + their event links;
-- claimer / admin can manage their own row.
-- ============================================================

alter table public.organisers enable row level security;
alter table public.event_organisers enable row level security;

-- Public can read approved organisers
drop policy if exists "organisers: public read approved" on public.organisers;
create policy "organisers: public read approved"
  on public.organisers for select
  to anon, authenticated
  using (approved = true);

-- Claimer can read their own row even if not yet approved
drop policy if exists "organisers: owner reads own" on public.organisers;
create policy "organisers: owner reads own"
  on public.organisers for select
  to authenticated
  using (claimed_by = auth.uid());

-- Claimer can update their own row
drop policy if exists "organisers: owner updates own" on public.organisers;
create policy "organisers: owner updates own"
  on public.organisers for update
  to authenticated
  using (claimed_by = auth.uid())
  with check (claimed_by = auth.uid());

-- Admin can do anything
drop policy if exists "organisers: admin all" on public.organisers;
create policy "organisers: admin all"
  on public.organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- event_organisers: public read all (mirrors event_artists), owner of
-- the linked organiser can insert / delete.
drop policy if exists "event_organisers: public read" on public.event_organisers;
create policy "event_organisers: public read"
  on public.event_organisers for select
  to anon, authenticated
  using (true);

drop policy if exists "event_organisers: claimer manages" on public.event_organisers;
create policy "event_organisers: claimer manages"
  on public.event_organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.organisers o
      where o.id = event_organisers.organiser_id
        and o.claimed_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.organisers o
      where o.id = event_organisers.organiser_id
        and o.claimed_by = auth.uid()
    )
  );

drop policy if exists "event_organisers: admin all" on public.event_organisers;
create policy "event_organisers: admin all"
  on public.event_organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
