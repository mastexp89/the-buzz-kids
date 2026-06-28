-- ============================================================
-- 026: Add a `nearby_areas` column to cities and seed the Angus
--      region.
--
-- Why: until now the site-importer's location filter was a hardcoded
--      constant ("Dundee" + ["Broughty Ferry"]). Moving it to the DB
--      lets each city carry its own list of towns/suburbs and lets us
--      add a second city (Angus) without touching code.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Schema: add nearby_areas to cities -----------------------------------
alter table public.cities
  add column if not exists nearby_areas text[] not null default '{}';

-- 2. Backfill existing Dundee row -----------------------------------------
update public.cities
   set nearby_areas = array['Broughty Ferry']
 where slug = 'dundee'
   and (nearby_areas is null or array_length(nearby_areas, 1) is null);

-- 3. Insert (or update) the Angus city row --------------------------------
insert into public.cities (name, slug, active, nearby_areas)
values (
  'Angus',
  'angus',
  true,
  array[
    -- Major towns
    'Arbroath',
    'Brechin',
    'Carnoustie',
    'Forfar',
    'Kirriemuir',
    'Monifieth',
    'Montrose',
    -- Smaller towns
    'Edzell',
    'Friockheim',
    'Letham',
    -- Notable villages (add more here if events show up from elsewhere
    -- and the AI rejects them as out-of-area)
    'Auchmithie',
    'Auchterhouse',
    'Birkhill',
    'Glamis',
    'Inverkeilor',
    'Newtyle',
    'Tannadice',
    'Tealing'
  ]
)
on conflict (slug) do update
  set name = excluded.name,
      active = excluded.active,
      nearby_areas = excluded.nearby_areas;

notify pgrst, 'reload schema';
