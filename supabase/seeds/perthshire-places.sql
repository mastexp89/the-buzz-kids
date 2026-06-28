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
