-- Richer seed for the launch towns — more real Dundee + Perthshire places.
-- Run in the Supabase SQL editor, then re-run the Google-photo backfill
-- (POST /api/admin/google-photos) to pull a photo for each. Safe to re-run.

insert into public.venues
  (city_id, name, slug, description, address, postcode, website, venue_type, age_min, age_max, is_free, price_from, setting, accessibility, booking_required, approved, auto_imported)
values
  -- Dundee
  ((select id from public.cities where slug = 'dundee'),
   'Energi Trampoline Park Dundee', 'energi-trampoline-park-dundee',
   'Wall-to-wall trampolines, a foam pit, dodgeball and toddler sessions.',
   'Camperdown Leisure Park, Dundee', 'DD2 3HX', 'https://energitrampolineparks.co.uk/dundee',
   'attraction', 3, 16, false, 9.00, 'indoor', '{buggy-friendly,wheelchair-accessible}', true, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'Discovery Point', 'discovery-point',
   'Climb aboard Captain Scott''s ship RRS Discovery and explore the polar exhibits.',
   'Discovery Quay, Dundee', 'DD1 4XA', 'https://www.rrsdiscovery.co.uk',
   'attraction', 3, 12, false, 11.50, 'indoor', '{wheelchair-accessible,buggy-friendly,changing-places}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'The McManus', 'the-mcmanus',
   'Dundee''s free art gallery and museum — dinosaurs, wildlife and family trails.',
   'Albert Square, Dundee', 'DD1 1DA', 'https://www.mcmanus.co.uk',
   'attraction', 0, 12, true, null, 'indoor', '{wheelchair-accessible,buggy-friendly,changing-places,quiet-space}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'Broughty Castle Museum', 'broughty-castle-museum',
   'A free seaside castle museum with cannons, armour and great views over the Tay.',
   'Castle Approach, Broughty Ferry, Dundee', 'DD5 2TF', 'https://www.leisureandculturedundee.com',
   'attraction', 3, 12, true, null, 'indoor', '{buggy-friendly}', false, true, true),

  ((select id from public.cities where slug = 'dundee'),
   'Avertical World', 'avertical-world',
   'Scotland''s biggest indoor climbing centre, with sessions and parties for kids.',
   'Blinshall Street, Dundee', 'DD1 5DF', 'https://www.averticalworld.co.uk',
   'attraction', 4, 16, false, 10.00, 'indoor', '{}', true, true, true),

  -- Perth & Perthshire
  ((select id from public.cities where slug = 'perth'),
   'Auchingarrich Wildlife Centre', 'auchingarrich-wildlife-centre',
   'Hilltop wildlife centre near Comrie — meerkats, wallabies, a soft play barn and views.',
   'Comrie, Perthshire', 'PH6 2JL', 'https://www.auchingarrich.co.uk',
   'attraction', 0, 12, false, 8.50, 'both', '{buggy-friendly}', false, true, true),

  ((select id from public.cities where slug = 'perth'),
   'Pitlochry Festival Theatre', 'pitlochry-festival-theatre',
   'Riverside theatre with family shows, an explorers'' garden and a café.',
   'Port-Na-Craig, Pitlochry', 'PH16 5DR', 'https://pitlochryfestivaltheatre.com',
   'programmes', 3, 16, false, 12.00, 'indoor', '{wheelchair-accessible,buggy-friendly,changing-places}', true, true, true),

  ((select id from public.cities where slug = 'perth'),
   'Crieff Hydro', 'crieff-hydro',
   'Family resort with an indoor pool, soft play, mini quads and loads of outdoor activities.',
   'Ferntower Road, Crieff', 'PH7 3LQ', 'https://www.crieffhydro.com',
   'both', 0, 16, false, 10.00, 'both', '{wheelchair-accessible,buggy-friendly,changing-places}', true, true, true)
on conflict (slug) do nothing;

insert into public.venue_genres (venue_id, genre_id)
select v.id, g.id from public.venues v, public.genres g
where (v.slug = 'energi-trampoline-park-dundee' and g.slug in ('trampoline','sports-camp'))
   or (v.slug = 'discovery-point'                and g.slug in ('museum-gallery','days-out'))
   or (v.slug = 'the-mcmanus'                    and g.slug in ('museum-gallery','arts-crafts'))
   or (v.slug = 'broughty-castle-museum'         and g.slug in ('museum-gallery','days-out'))
   or (v.slug = 'avertical-world'                and g.slug in ('sports-camp','outdoor-adventure'))
   or (v.slug = 'auchingarrich-wildlife-centre'  and g.slug in ('farm-animals','outdoor-adventure'))
   or (v.slug = 'pitlochry-festival-theatre'     and g.slug in ('theatre','drama'))
   or (v.slug = 'crieff-hydro'                   and g.slug in ('days-out','outdoor-adventure','swimming'))
on conflict do nothing;
