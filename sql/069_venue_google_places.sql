-- 069_venue_google_places.sql  (The Buzz Kids)
-- Store each place's Google listing + a photo pulled from the Google Places
-- API (New), so the Places directory can show a real photo even before an
-- organiser uploads their own. Google requires the author attribution to be
-- displayed alongside the photo, so we store it too.

alter table public.venues add column if not exists google_place_id text;
alter table public.venues add column if not exists google_photo_url text;          -- resolved photoUri from the Places Photo API
alter table public.venues add column if not exists google_photo_attribution text;  -- author attribution to show with the photo
alter table public.venues add column if not exists google_synced_at timestamptz;   -- last successful Google fetch

create index if not exists venues_google_place_id_idx on public.venues (google_place_id);
