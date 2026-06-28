-- ============================================================
-- 054: Festival layout mode + programme content
--
-- Some festivals (Bruce, smaller community ones) happen in a single
-- park with multiple "arenas" or zones rather than across multiple
-- separate venues. For those, the existing multi-venue tabs don't fit:
-- Venues shows "0 VENUES", Map shows nothing useful, and the meaty
-- content (arena timetables, parking, all-day attractions) has
-- nowhere to live.
--
-- This adds a per-festival layout toggle:
--   • multi_venue (default) — current behaviour: Schedule/Venues/Artists/Map/My picks
--   • programme              — Schedule/Programme/Artists/My picks, no Venues, no Map
--
-- `programme_content` holds the long-form markdown shown in the new
-- Programme tab. Plain festivals can leave it empty.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS layout_mode text NOT NULL DEFAULT 'multi_venue'
    CHECK (layout_mode IN ('multi_venue', 'programme'));

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS programme_content text;

COMMENT ON COLUMN public.festivals.layout_mode IS
  'Page layout. multi_venue = default tabs (Schedule/Venues/Artists/Map/Picks). programme = single-park festivals: shows a Programme tab with markdown content and hides Venues/Map tabs.';

COMMENT ON COLUMN public.festivals.programme_content IS
  'Markdown content for the Programme tab — arena timetables, all-day attractions, travel info. Only shown when layout_mode = programme. Same markdown features as description.';
