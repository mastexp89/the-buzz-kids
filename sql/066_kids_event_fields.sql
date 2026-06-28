-- =====================================================================
-- 066 — Kids' event fields  (The Buzz Kids fork)
-- =====================================================================
-- The Buzz Guide models single-night gigs. Kids'/family events need a
-- richer shape: who it's for (age), what it costs + whether you must
-- pre-book, indoor vs outdoor (rain backup), multi-day / recurring runs
-- (a camp runs Mon–Fri; a club runs weekly for 6 weeks), and the
-- accessibility / sensory facets parents filter on hard.
--
-- All additive + idempotent (`add column if not exists`), so it's safe
-- to run on a fresh DB after schema.sql + the existing 002–065 chain.
-- It also re-seeds the `genres` taxonomy (reused as activity CATEGORIES
-- for this product) from music genres to kid-activity categories.
-- =====================================================================

-- 1. EVENT FIELDS -----------------------------------------------------

-- Age suitability, in YEARS. age_min 0 = suitable from birth (baby/toddler).
-- NULL on either side = open-ended (no lower / no upper bound, i.e. all ages).
alter table public.events add column if not exists age_min smallint;
alter table public.events add column if not exists age_max smallint;

-- Pricing. cover_charge (existing text col) stays the human display string
-- ("Free", "£5", "£8 / £6 conc"). These two are for FILTERING only.
alter table public.events add column if not exists is_free boolean not null default false;
alter table public.events add column if not exists price_from numeric(7,2); -- lowest £ price; NULL = unknown

-- Booking. ticket_url (existing) doubles as the booking link.
alter table public.events add column if not exists booking_required boolean not null default false;

-- Indoor / outdoor — the rain-backup filter.
alter table public.events add column if not exists setting text
  check (setting is null or setting in ('indoor','outdoor','both'));

-- Multi-day & recurring runs.
--   end_date           — last day of a multi-day run (Mon–Fri camp). NULL = single day.
--   recurrence_pattern — normalised cadence: 'weekdays' | 'weekly' | 'daily'
--                        | 'every_saturday' | 'every_sunday' | 'school_holidays' | ...
--                        NULL = one-off.
--   recurrence_until   — date a weekly/recurring series stops. NULL = open-ended.
alter table public.events add column if not exists end_date date;
alter table public.events add column if not exists recurrence_pattern text;
alter table public.events add column if not exists recurrence_until date;

-- Accessibility / sensory facets. Free-form text[] over an app-enforced
-- vocabulary (kept flexible in the DB so new facets don't need a migration):
--   'autism-friendly' | 'sensory-session' | 'quiet-space' | 'ear-defenders'
--   | 'changing-places' | 'carer-free' | 'wheelchair-accessible'
--   | 'buggy-friendly' | 'bsl' | 'makaton'
alter table public.events add column if not exists accessibility text[] not null default '{}';

-- 2. INDEXES FOR THE NEW FILTERS --------------------------------------
create index if not exists events_age_idx     on public.events (age_min, age_max);
create index if not exists events_is_free_idx on public.events (is_free);
create index if not exists events_setting_idx on public.events (setting);
create index if not exists events_end_date_idx on public.events (end_date);
-- GIN for "has any of these accessibility facets" (&&) / "has all" (@>).
create index if not exists events_accessibility_idx on public.events using gin (accessibility);

-- 3. ACTIVITY CATEGORIES (reuses the `genres` table) ------------------
-- Fresh-DB safe: at fork time no events reference any genre yet, so we
-- clear the inherited music genres and seed kid-activity categories.
-- (event_genres has ON DELETE CASCADE, so this is clean on an empty DB.)
delete from public.genres;

insert into public.genres (name, slug) values
  ('Soft play',                'soft-play'),
  ('Trampoline park',          'trampoline'),
  ('Farms & animals',          'farm-animals'),
  ('Zoos & aquariums',         'zoo-aquarium'),
  ('Library & story time',     'library'),
  ('Arts & crafts',            'arts-crafts'),
  ('Museums & galleries',      'museum-gallery'),
  ('Theatre & shows',          'theatre'),
  ('Cinema & screenings',      'cinema'),
  ('Music & singing',          'music-singing'),
  ('Dance',                    'dance'),
  ('Drama & performance',      'drama'),
  ('Multi-sport camp',         'sports-camp'),
  ('Football',                 'football'),
  ('Swimming',                 'swimming'),
  ('STEM & coding',            'stem-coding'),
  ('Outdoor & adventure',      'outdoor-adventure'),
  ('Forest & nature',          'forest-nature'),
  ('Holiday club',             'holiday-club'),
  ('Baby & toddler groups',    'toddler-group'),
  ('Sensory play',             'sensory'),
  ('Days out & attractions',   'days-out'),
  ('Seasonal & festive',       'seasonal'),
  ('Fairs & funfairs',         'fun-fair'),
  ('Free activities',          'free-play')
  on conflict (slug) do nothing;
