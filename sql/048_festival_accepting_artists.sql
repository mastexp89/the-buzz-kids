-- ============================================================
-- 048: Festival "accepting artist submissions" toggle
--
-- Controls whether the "Want to be involved?" / "Want to play?" CTAs
-- show on the public festival page. When false, the festival is full
-- and the banner + ArtistsGrid empty-state CTA are hidden, even if a
-- contact_email is set. The contact_email itself stays so admin can
-- still see who to reach out to from the back office.
--
-- Defaults to true so existing festivals don't suddenly lose their
-- "want to play" banner on next render.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS accepting_artists boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.festivals.accepting_artists IS
  'When false, hides the "Want to be involved / Want to play" CTAs on the public festival page. Use when the festival lineup is full.';
