-- ----------------------------------------------------------------------------
-- 043: Auto-link festival_venues when an event references a festival
-- ----------------------------------------------------------------------------
-- The public venue page shows a "Taking part in [festival]" banner whenever
-- there's a festival_venues row linking the venue to a live festival. That
-- row is normally added by admin in the festival editor. But admins also
-- create events with `festival_id` set directly (festival schedule entry,
-- AI extraction, etc) — and used to forget to also add the venue to the
-- festival's venue list, so the banner wouldn't show.
--
-- This trigger closes that gap: any time an event row gets a festival_id +
-- venue_id pair, we INSERT into festival_venues with ON CONFLICT DO NOTHING.
-- Idempotent, race-safe, no surprises. SECURITY DEFINER because the user
-- inserting the event (venue owner, AI cron) won't have direct INSERT
-- permission on festival_venues — only admins do via RLS.
--
-- Also backfills existing events at the bottom so the rule applies
-- retroactively.

CREATE OR REPLACE FUNCTION public.auto_link_festival_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.festival_id IS NOT NULL AND NEW.venue_id IS NOT NULL THEN
    INSERT INTO public.festival_venues (festival_id, venue_id)
    VALUES (NEW.festival_id, NEW.venue_id)
    ON CONFLICT (festival_id, venue_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Replace any prior definition (idempotent re-runs).
DROP TRIGGER IF EXISTS events_auto_link_festival_venue ON public.events;

-- Fire on both INSERT and UPDATE — an event might initially have no
-- festival_id and later get reassigned to a festival, in which case we
-- still want the venue link to materialise.
CREATE TRIGGER events_auto_link_festival_venue
  AFTER INSERT OR UPDATE OF festival_id, venue_id ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_festival_venue();

-- ---- Backfill --------------------------------------------------------------
-- Any existing event with a festival_id + venue_id pair should also have
-- the corresponding festival_venues row. ON CONFLICT DO NOTHING so this
-- migration is safe to re-run.
INSERT INTO public.festival_venues (festival_id, venue_id)
SELECT DISTINCT e.festival_id, e.venue_id
FROM public.events e
WHERE e.festival_id IS NOT NULL
  AND e.venue_id   IS NOT NULL
ON CONFLICT (festival_id, venue_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
