
-- ===================== sql/069_venue_google_places.sql =====================
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


-- ===================== sql/070_perth_perthshire.sql =====================
-- 070_perth_perthshire.sql  (The Buzz Kids)
-- Make Perth & Perthshire a live location. Perth ships as an inactive
-- "coming soon" city in schema.sql; here we activate it, widen it to the
-- whole shire, and list the towns it covers (like Angus / Fife do).

update public.cities
set name = 'Perth & Perthshire',
    active = true,
    nearby_areas = '{Crieff,Pitlochry,Blairgowrie,Aberfeldy,Auchterarder,Dunkeld,Scone,Kinross,"Coupar Angus"}'
where slug = 'perth';

-- Safety net if the seed row was ever removed.
insert into public.cities (name, slug, active, nearby_areas)
select 'Perth & Perthshire', 'perth', true,
       '{Crieff,Pitlochry,Blairgowrie,Aberfeldy,Auchterarder,Dunkeld,Scone,Kinross,"Coupar Angus"}'
where not exists (select 1 from public.cities where slug = 'perth');


-- ===================== supabase/seeds/dundee-places.sql =====================
-- Seed a few real Dundee places so the Places directory has something to show
-- (and so the Google-photo fetch has real venues to match). Safe to re-run.

insert into public.venues
  (city_id, name, slug, description, address, postcode, venue_type, age_min, age_max, is_free, price_from, setting, accessibility, booking_required, approved, auto_imported)
values
  ((select id from public.cities where slug = 'dundee'),
   'Camperdown Wildlife Centre', 'camperdown-wildlife-centre',
   'A small wildlife park in Camperdown Country Park — brown bears, lemurs, meerkats and a big adventure play area next door.',
   'Camperdown Country Park, Dundee', 'DD2 4TF', 'attraction', 0, 12, false, 4.50, 'outdoor',
   '{buggy-friendly,wheelchair-accessible}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'Dundee Science Centre', 'dundee-science-centre',
   'Hands-on science exhibits, live shows and a planetarium — easily a half-day in the warm.',
   '14 Greenmarket, Dundee', 'DD1 4QB', 'attraction', 3, 12, false, 6.50, 'indoor',
   '{wheelchair-accessible,buggy-friendly,autism-friendly,quiet-space}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'V&A Dundee', 'va-dundee',
   'Scotland''s design museum on the waterfront. Free to get in, with family trails and a brilliant riverside spot.',
   '1 Riverside Esplanade, Dundee', 'DD1 4EZ', 'attraction', 0, 14, true, null, 'indoor',
   '{wheelchair-accessible,buggy-friendly,changing-places,carer-free}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'Olympia Leisure Centre', 'olympia-leisure-centre',
   'Dundee''s waterfront pool with flumes, a lazy river and a toddler splash area.',
   'Earl Grey Place, Dundee', 'DD1 4DE', 'attraction', 0, 14, false, 4.50, 'indoor',
   '{wheelchair-accessible,buggy-friendly,changing-places}', false, true, true)
on conflict (slug) do nothing;

-- Tag each place with its categories (reuses the genres taxonomy via venue_genres).
insert into public.venue_genres (venue_id, genre_id)
select v.id, g.id from public.venues v, public.genres g
where (v.slug = 'camperdown-wildlife-centre' and g.slug in ('farm-animals','outdoor-adventure'))
   or (v.slug = 'dundee-science-centre'       and g.slug in ('stem-coding','museum-gallery'))
   or (v.slug = 'va-dundee'                   and g.slug in ('museum-gallery','arts-crafts'))
   or (v.slug = 'olympia-leisure-centre'      and g.slug in ('swimming'))
on conflict do nothing;


-- ===================== supabase/seeds/perthshire-places.sql =====================
-- A few real Perth & Perthshire places so the new location has content
-- (and the Google-photo fetch has venues to match). Safe to re-run.

insert into public.venues
  (city_id, name, slug, description, address, postcode, venue_type, age_min, age_max, is_free, price_from, setting, accessibility, booking_required, approved, auto_imported)
values
  ((select id from public.cities where slug = 'perth'),
   'Perth Leisure Pool', 'perth-leisure-pool',
   'Big leisure pool with flumes, a wave machine and a gentle toddler beach area.',
   'Glasgow Road, Perth', 'PH2 0PT', 'attraction', 0, 14, false, 4.50, 'indoor',
   '{wheelchair-accessible,buggy-friendly,changing-places}', false, true, true),

  ((select id from public.cities where slug = 'perth'),
   'Scone Palace', 'scone-palace',
   'Grand palace and grounds with a maze, an adventure playground and peacocks roaming about.',
   'Scone, Perth', 'PH2 6BD', 'attraction', 0, 12, false, 7.00, 'both',
   '{buggy-friendly,wheelchair-accessible}', false, true, true),

  ((select id from public.cities where slug = 'perth'),
   'Highland Safaris', 'highland-safaris',
   'Red deer centre and mountain safaris near Aberfeldy — feed the deer and pan for gold.',
   'Dull, Aberfeldy', 'PH15 2JQ', 'attraction', 0, 12, false, 6.00, 'outdoor',
   '{buggy-friendly}', false, true, true)
on conflict (slug) do nothing;

insert into public.venue_genres (venue_id, genre_id)
select v.id, g.id from public.venues v, public.genres g
where (v.slug = 'perth-leisure-pool' and g.slug in ('swimming'))
   or (v.slug = 'scone-palace'        and g.slug in ('days-out','outdoor-adventure'))
   or (v.slug = 'highland-safaris'     and g.slug in ('farm-animals','outdoor-adventure'))
on conflict do nothing;

