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
