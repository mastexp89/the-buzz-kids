-- Run this AFTER 006-prospects.sql.
-- Seeds the outreach tracker with known Dundee venues, bars and clubs.
-- IMPORTANT: please verify each venue is still operating before contacting —
-- some may have closed, rebranded, or changed hands since this list was compiled.

with dundee as (select id from public.cities where slug = 'dundee' limit 1)
insert into public.prospects (name, type, city_id, status, notes)
select v.name, v.type, dundee.id, 'not_contacted', v.notes
from dundee, (values
  -- ============== LIVE MUSIC VENUES / NIGHTCLUBS ==============
  ('Fat Sams',                     'venue',   'South Ward Road. Long-running live music venue + nightclub.'),
  ('Beat Generator Live!',         'venue',   'North Lindsay Street. Independent music venue.'),
  ('Buskers',                      'venue',   'Live music & bar.'),
  ('Church',                       'club',    'South Ward Road nightclub (formerly Liquid).'),
  ('Underground',                  'club',    'Basement nightclub.'),
  ('The Doghouse',                 'venue',   'Pub + live music venue.'),
  ('Reading Rooms',                'venue',   'Blackscroft (verify still operating).'),

  -- ============== THEATRES / CONCERT HALLS ==============
  ('Caird Hall',                   'theatre', 'City Square. Major concert hall, council-run.'),
  ('Whitehall Theatre',            'theatre', 'Bellfield Street. Independent theatre.'),
  ('Dundee Rep Theatre',           'theatre', 'Tay Square. Has Rep Bar — sometimes hosts music.'),
  ('Gardyne Theatre',              'theatre', 'Dundee & Angus College campus.'),
  ('Bonar Hall',                   'theatre', 'University of Dundee, Park Place.'),
  ('Marryat Hall',                 'theatre', 'Adjoining Caird Hall — smaller events.'),

  -- ============== PUBS WITH REGULAR LIVE MUSIC ==============
  ('The Phoenix Bar',              'pub',     'Nethergate. Live music regularly.'),
  ('Drouthys',                     'pub',     'Perth Road. Whisky bar, regular live music.'),
  ('The Bowery',                   'bar',     'Cocktails + live music.'),
  ('Dukes Corner',                 'pub',     'Brown Street. Live music & gigs.'),
  ('Speedwell Bar (Mennies)',      'pub',     'Perth Road institution.'),
  ('The Globe Bar',                'pub',     'Hawkhill — live music welcome.'),
  ('The Trades House Bar',         'pub',     'Nethergate.'),
  ('The Tickety Boos',             'bar',     'Live music + bar.'),

  -- ============== CITY CENTRE BARS / PUBS ==============
  ('Aitkens Bar',                  'pub',     'Traditional Dundee pub.'),
  ('Jute Café Bar',                'bar',     'Inside Dundee Contemporary Arts (DCA).'),
  ('The Wine Press',               'bar',     'Wine bar, Shore Terrace.'),
  ('The Counting House',           'pub',     'Wetherspoons, Reform Street.'),
  ('Drouthy Neebors',              'pub',     'Old Hawkhill chain pub.'),
  ('Henrys',                       'bar',     'City centre bar.'),
  ('O''Mally''s',                  'pub',     'Irish pub.'),
  ('Number 57',                    'bar',     'Cocktails / casual bar.'),
  ('The Steeple',                  'pub',     'Nethergate.'),
  ('The Barrelman',                'pub',     'Cowgate.'),
  ('Daiquiri Blue',                'bar',     'Cocktail bar.'),
  ('Innis & Gunn Beer Kitchen',    'bar',     'Murraygate / city centre.'),
  ('Frews Bar',                    'pub',     'Strathmartine Road.'),
  ('Tally Ho',                     'pub',     'City centre.'),
  ('Old Bank Bar',                 'pub',     'Reform Street.'),

  -- ============== WEST END / PERTH ROAD ==============
  ('Bach Bar',                     'bar',     'Perth Road area.'),
  ('Taybridge Bar',                'pub',     'West End traditional pub.'),
  ('Roseangle Arts Café',          'bar',     'Roseangle — café/bar with events.'),
  ('Verdant Works Cafe Bar',       'bar',     'Verdant Works museum venue.'),
  ('Daily Grind',                  'bar',     'Perth Road.'),

  -- ============== BROUGHTY FERRY ==============
  ('Fishermans Tavern',            'pub',     'Fort Street, Broughty Ferry. Famous folk-music pub.'),
  ('The Ship Inn',                 'pub',     'Fisher Street, Broughty Ferry. Riverside pub.'),
  ('The Anchor Bar',               'pub',     'Gray Street, Broughty Ferry.'),
  ('The Royal Arch',               'pub',     'Broughty Ferry.'),
  ('Eduardo''s',                   'bar',     'Broughty Ferry.'),
  ('The Occidental',               'pub',     'Broughty Ferry.'),
  ('Foundry Bar',                  'pub',     'Broughty Ferry.'),
  ('The Caenlochan',               'pub',     'Broughty Ferry.'),
  ('Visocchi''s',                  'bar',     'Broughty Ferry — café/bar.'),

  -- ============== HOTELS (likely have bars / events space) ==============
  ('Apex City Quay Hotel',         'hotel',   'City Quay — has bar/restaurant.'),
  ('Hotel Indigo Dundee',          'hotel',   'Lower Dock Street — boutique hotel with bar.'),
  ('Malmaison Dundee',             'hotel',   'Whitehall Crescent — has restaurant/bar.'),
  ('DoubleTree by Hilton Dundee',  'hotel',   'River-side, Discovery Quay.'),
  ('Best Western Queens Hotel',    'hotel',   'Nethergate.'),
  ('Staybridge Suites Dundee',     'hotel',   'Marketgait.'),
  ('Sleeperz Hotel Dundee',        'hotel',   'V&A area.'),
  ('Hampton by Hilton Dundee',     'hotel',   'City centre.'),

  -- ============== RESTAURANTS / CAFES THAT HOST EVENTS ==============
  ('Empire State Coffee',          'restaurant','Sometimes hosts live music / events.'),
  ('Pacamara',                     'restaurant','Café — occasionally hosts music.'),
  ('Avery & Co',                   'bar',     'Reform Street area.'),

  -- ============== UNIVERSITY VENUES ==============
  ('Dundee Students'' Union',      'venue',   'Airlie Place — DUSA student venues + Mono.'),
  ('Abertay Students'' Union',     'venue',   'Abertay University.')
) as v(name, type, notes)
on conflict do nothing;
