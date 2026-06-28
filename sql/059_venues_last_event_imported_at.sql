-- ============================================================
-- 059: Track when each venue last had an event imported
--
-- Lets the FB scrape cron skip venues that are clearly dormant.
-- "Dormant" = no event landed for this venue in the last 90 days,
-- which strongly suggests scraping their FB page is unproductive
-- (they're either a pub that doesn't do gigs, a closed venue, or
-- a FB page that's gone silent).
--
-- We use event `created_at` not `start_time` — what we care about is
-- "when did the system last find a gig here", not "when did their
-- last gig happen". A venue could have hosted nothing for 6 months
-- but their FB page suddenly post next month's gig list; we want to
-- catch that, so the column updates the instant the cron writes a
-- row, not based on the gig date.
--
-- Backfilled from existing events. Auto-updated by a trigger on
-- event INSERT so the column stays accurate without any app changes.
-- ============================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS last_event_imported_at timestamptz;

-- Backfill: for every venue with any events, set this to the most
-- recent event's created_at. Venues with no events leave it NULL,
-- which the cron treats as "dormant" too.
UPDATE public.venues v
SET last_event_imported_at = sub.last_at
FROM (
  SELECT venue_id, MAX(created_at) AS last_at
  FROM public.events
  WHERE venue_id IS NOT NULL
  GROUP BY venue_id
) sub
WHERE v.id = sub.venue_id
  AND v.last_event_imported_at IS DISTINCT FROM sub.last_at;

-- Index: the cron's "is this venue dormant?" filter compares against
-- a moving 90-day cutoff. DESC NULLS LAST so the "newest event" query
-- is cheap, and the predicate filter on dormancy is index-supported.
CREATE INDEX IF NOT EXISTS venues_last_event_imported_at_idx
  ON public.venues(last_event_imported_at DESC NULLS LAST);

-- Trigger: keep the column up to date as the cron / admin / paste-
-- fixtures tools land new events. Only fires on INSERT — UPDATE-ing
-- a start_time on an existing event doesn't change "when we last
-- found a gig here". DELETE is intentionally not handled (deleting
-- the only event from a venue doesn't make it dormant retroactively;
-- the field just stays stale and the venue's still scraped at the
-- normal cadence until 90 days pass).
CREATE OR REPLACE FUNCTION public.bump_venue_last_event_imported_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    UPDATE public.venues
    SET last_event_imported_at = GREATEST(
      COALESCE(last_event_imported_at, NEW.created_at),
      NEW.created_at
    )
    WHERE id = NEW.venue_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_bump_venue_last_imported ON public.events;
CREATE TRIGGER events_bump_venue_last_imported
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bump_venue_last_event_imported_at();

COMMENT ON COLUMN public.venues.last_event_imported_at IS
  'Timestamp when an event was last created (inserted) for this venue, regardless of when the gig itself happens. Used by the FB scrape cron to identify dormant venues — those with no recent event imports get scraped on a longer cooldown to save Apify cost without losing coverage of venues that actually produce content.';

notify pgrst, 'reload schema';
