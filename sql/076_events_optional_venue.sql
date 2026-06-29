-- ============================================================
-- The Buzz Kids: events no longer have to be tied to a place.
-- A town-wide gala or fayre can stand on its own with just a
-- location name + an area (city). venue_id becomes optional.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

-- venue_id optional (was NOT NULL, inherited from the gigs model).
alter table public.events alter column venue_id drop not null;

-- Standalone-event fields used when there's no venue attached.
alter table public.events
  add column if not exists location_name text,                         -- e.g. "Castle Green, Broughty Ferry"
  add column if not exists city_id uuid references public.cities(id);   -- which area it belongs to (for the area filter)

create index if not exists events_city_idx on public.events (city_id);

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
