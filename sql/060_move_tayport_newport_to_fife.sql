-- ============================================================
-- 060: Move Tayport + Newport-on-Tay venues from Dundee → Fife
--
-- Tayport and Newport-on-Tay sit on the Fife side of the Tay
-- Bridge — geographically they're in the Fife council area, not
-- Dundee. When sql/057 added Fife as its own region it didn't
-- include these two villages, so existing venues at those
-- addresses are still tagged with Dundee's city_id.
--
-- This migration:
--   1. Adds Tayport + Newport-on-Tay to Fife's `nearby_areas`
--      array so future events / venue imports in those towns
--      route to /fife automatically.
--   2. Reassigns any existing venue whose address mentions
--      Tayport or Newport-on-Tay from Dundee → Fife.
--
-- Match is by `address ILIKE` rather than postcode because
-- the address field is always present, while postcodes may be
-- blank on legacy venue rows. Covers common spelling variants
-- ("Newport-on-Tay", "Newport on Tay", "Newport, Fife").
--
-- Idempotent: safe to re-run. `array_append` only adds the town
-- if not already present; the venue UPDATE no-ops when city_id
-- is already Fife.
-- ============================================================

-- 1. Extend Fife's nearby_areas with the two North Fife villages
update public.cities
   set nearby_areas = (
     -- De-duplicating set-builder: combine the existing array with the
     -- two new entries, drop duplicates, sort. Stops a re-run from
     -- producing "Tayport, Tayport".
     select array(
       select distinct unnest(nearby_areas || array['Tayport', 'Newport-on-Tay'])
     )
   )
 where slug = 'fife';

-- 2. Reassign matching venues from Dundee → Fife.
--    Both subqueries are scalar — there's only one row per slug.
update public.venues
   set city_id = (select id from public.cities where slug = 'fife')
 where city_id = (select id from public.cities where slug = 'dundee')
   and (
     address ilike '%Tayport%'
     or address ilike '%Newport-on-Tay%'
     or address ilike '%Newport on Tay%'
     or address ilike '%Newport, Fife%'
   );

notify pgrst, 'reload schema';
