-- ============================================================
-- 057: Add the Fife region.
--
-- Models the same way Angus does: one `cities` row with slug `fife`
-- and a `nearby_areas` array listing every town/village the region
-- covers. The public city page renders "Covering X, Y, Z…" from
-- nearby_areas automatically, and the site importer / event scraper
-- uses the array to decide which Fife-region events belong on the
-- /fife page.
--
-- Includes the four headline towns (Dunfermline, Glenrothes,
-- Kirkcaldy, St Andrews) plus a sensible second tier:
--   • Forth-coast commuter belt: Inverkeithing, Rosyth, Aberdour
--   • Levenmouth (the train line just reopened): Leven
--   • Central Fife with an actual venue: Lochgelly, Cowdenbeath
--   • East Neuk: Anstruther (covers the wider East Neuk gigs)
--   • Cupar — historic market town with a few pubs
--
-- Easy to extend later by editing the array via /admin/cities or a
-- follow-up migration — keep adding villages as events surface there.
--
-- Idempotent: safe to re-run.
-- ============================================================

insert into public.cities (name, slug, active, nearby_areas)
values (
  'Fife',
  'fife',
  true,
  array[
    -- Major towns
    'Dunfermline',
    'Glenrothes',
    'Kirkcaldy',
    'St Andrews',
    -- Second-tier towns with venues / pub scenes worth listing
    'Cupar',
    'Leven',
    'Burntisland',
    'Lochgelly',
    'Cowdenbeath',
    'Anstruther',
    'Aberdour',
    'Inverkeithing',
    'Rosyth'
  ]
)
on conflict (slug) do update
  set name = excluded.name,
      active = excluded.active,
      nearby_areas = excluded.nearby_areas;

notify pgrst, 'reload schema';
