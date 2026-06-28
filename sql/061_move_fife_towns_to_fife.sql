-- ============================================================
-- 061: Bulk-reassign Fife-area venues to the Fife region
--
-- When Fife was added (sql/057) only the cities row got created.
-- Venues that geographically belong to Fife (Anstruther, Dunfermline,
-- Kirkcaldy, St Andrews, Cupar, Burntisland etc.) were still tagged
-- to whatever city they were originally imported under — usually
-- Dundee or NULL — so a `?city=fife` scoped scrape silently skipped
-- them and they didn't appear on /fife at all.
--
-- This migration finds every venue whose address mentions a Fife
-- town from the official nearby_areas list and re-tags its city_id
-- to Fife. Two safety guards:
--   • Only moves venues currently tagged to a different city (or
--     NULL). Venues already on Fife stay put.
--   • Match is case-insensitive against the address text. We don't
--     touch venues without a populated address (no signal to act on).
--
-- Idempotent: re-running is a no-op because all matching venues
-- already have city_id = fife after the first pass.
-- ============================================================

-- Lock the Fife id once so the UPDATE below is a single scalar.
WITH fife AS (
  SELECT id FROM public.cities WHERE slug = 'fife'
)
UPDATE public.venues v
SET city_id = (SELECT id FROM fife)
WHERE
  -- Don't touch venues already on Fife.
  (v.city_id IS DISTINCT FROM (SELECT id FROM fife))
  AND v.address IS NOT NULL
  AND (
    v.address ILIKE '%Dunfermline%'
    OR v.address ILIKE '%Glenrothes%'
    OR v.address ILIKE '%Kirkcaldy%'
    OR v.address ILIKE '%St Andrews%'
    OR v.address ILIKE '%St. Andrews%'        -- common variant with period
    OR v.address ILIKE '%Cupar%'
    OR v.address ILIKE '%Leven%'
    OR v.address ILIKE '%Burntisland%'
    OR v.address ILIKE '%Lochgelly%'
    OR v.address ILIKE '%Cowdenbeath%'
    OR v.address ILIKE '%Anstruther%'
    OR v.address ILIKE '%Aberdour%'
    OR v.address ILIKE '%Inverkeithing%'
    OR v.address ILIKE '%Rosyth%'
    OR v.address ILIKE '%Tayport%'             -- belt-and-braces; sql/060 already did these
    OR v.address ILIKE '%Newport-on-Tay%'
    OR v.address ILIKE '%Newport on Tay%'
  );

notify pgrst, 'reload schema';
