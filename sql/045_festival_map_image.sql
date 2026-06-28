-- ============================================================
-- 045: Festival map image
--
-- Adds a separate map_image_url column so festivals can display an
-- illustrated site map / venue layout (e.g. MoFest's High Street
-- map showing stages, food trucks, kids rides).
--
-- This is distinct from:
--   - hero_image_url — the wide brand cover behind the landing hero
--   - logo_url       — the square brand mark used on cards
--
-- The map image gets rendered at the top of the public festival
-- page's "Map" tab, above the live Leaflet venue map.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS map_image_url text;

COMMENT ON COLUMN public.festivals.map_image_url IS
  'Illustrated site map / venue layout, uploaded by admin. Rendered above the Leaflet map on the public festival page.';
