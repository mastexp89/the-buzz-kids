-- Track which unclaimed venues we've already DM'd on Facebook (or any
-- other manual outreach channel). Powers /admin/venue-outreach so we
-- don't double-message anyone.
--
-- Single timestamp column is enough for now — we don't need a separate
-- table of who-messaged-when until we have multiple people doing
-- outreach. Can backfill from this column into a richer schema later.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS outreach_messaged_at timestamptz;

-- Quick index for the "not yet messaged" filter used by the outreach page.
CREATE INDEX IF NOT EXISTS venues_outreach_not_messaged_idx
  ON public.venues (outreach_messaged_at)
  WHERE outreach_messaged_at IS NULL AND owner_id IS NULL AND facebook IS NOT NULL;
