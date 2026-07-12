-- "Places to stay" — family-friendly accommodation near your days out.
-- Populated by the Apify Google Maps scraper (source='google') and later OSM
-- (source='osm'); the public /stay section + "Stay nearby" strip on venue
-- pages read approved rows. booking_url is the affiliate deep-link, filled in
-- Phase 2 once Booking.com / Awin / Picniq are approved. Run in the SQL editor.

create table if not exists stays (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text unique,
  norm_name           text not null,               -- normalised, for dedupe
  stay_type           text not null,               -- 'hotel' | 'cottage' | 'glamping' | 'caravan'
  city_id             uuid references cities(id) on delete set null,
  city_slug           text,                         -- denormalised for query ease
  address             text,
  postcode            text,
  latitude            double precision,
  longitude           double precision,
  website             text,
  phone               text,
  photo_url           text,                         -- primary/hero photo
  gallery_image_urls  text[],
  google_rating       numeric,
  google_rating_count int,
  google_place_id     text,                         -- nullable (OSM rows have none)
  booking_url         text,                         -- affiliate deep-link (Phase 2)
  description         text,
  source              text not null default 'google', -- 'google' | 'osm' | 'manual'
  approved            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per Google place; multiple NULLs allowed for OSM/manual entries.
create unique index if not exists stays_google_place_id_uq
  on stays (google_place_id) where google_place_id is not null;

create index if not exists stays_type_city   on stays (stay_type, city_slug);
create index if not exists stays_approved     on stays (approved, stay_type);
create index if not exists stays_bbox         on stays (latitude, longitude);
create index if not exists stays_norm_name    on stays (norm_name);

alter table stays enable row level security;

-- Public can read approved stays; writes are service-role only (matches venues).
drop policy if exists "stays public read" on stays;
create policy "stays public read" on stays
  for select using (approved = true);
