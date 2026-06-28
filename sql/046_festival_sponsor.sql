-- ============================================================
-- 046: Festival sponsor link
--
-- One festival can have one headline sponsor (e.g. GoFibre for MoFest).
-- We point at the existing sponsors table rather than store the logo +
-- name on festivals directly, so sponsor changes (logo update, status
-- toggle) flow through automatically and the same advertiser can sponsor
-- multiple things.
--
-- Many-to-many isn't needed yet — one headline sponsor per festival is
-- the pattern we're seeing in the wild. Can be promoted to a join table
-- later if multi-sponsor billing becomes a thing.
--
-- ON DELETE SET NULL — deleting a sponsor doesn't delete the festival;
-- the slot just clears so the admin can pick a replacement.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_id uuid
    REFERENCES public.sponsors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS festivals_sponsor_idx
  ON public.festivals(sponsor_id) WHERE sponsor_id IS NOT NULL;

COMMENT ON COLUMN public.festivals.sponsor_id IS
  'Headline sponsor for this festival. Renders as a logo + name card on the festival landing page above the description. References the shared sponsors table.';
