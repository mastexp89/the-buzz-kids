-- ============================================================
-- 049: Festival standalone sponsor fields
--
-- Festivals often have their own headline sponsor (e.g. GoFibre for
-- MoFest) that has no relationship to The Buzz Guide's own advertising
-- programme — the festival organiser arranged it themselves. We were
-- previously pointing festival.sponsor_id at the shared `sponsors`
-- table, which forced these external-to-The-Buzz arrangements to be
-- materialised as Buzz advertisers (showing up in the rotating
-- homepage banner, /sponsors directory etc.). Wrong.
--
-- This adds three nullable columns directly on festivals so an admin
-- can type the sponsor's name + upload their logo + paste their URL
-- without polluting the Buzz sponsors table.
--
-- The legacy sponsor_id column stays in place (no drop) so old data
-- isn't lost, but the public page + admin form switch to the new
-- columns. We can drop sponsor_id later once we're sure no festival
-- relies on it.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_name text;

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_logo_url text;

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_url text;

COMMENT ON COLUMN public.festivals.sponsor_name IS
  'Standalone festival sponsor display name (e.g. "GoFibre"). Not linked to Buzz sponsors. Renders alongside sponsor_logo_url + sponsor_url on the public festival page.';

COMMENT ON COLUMN public.festivals.sponsor_logo_url IS
  'Standalone festival sponsor logo image. Public URL, typically from Supabase Storage under festivals/<id>/sponsor-*.';

COMMENT ON COLUMN public.festivals.sponsor_url IS
  'Standalone festival sponsor click-through URL. Optional — sponsor card renders unlinked when empty.';
