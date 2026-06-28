-- ============================================================
-- 056: Festival lineup
--
-- A way for admins to type in a festival's lineup without going
-- through the full event + venue setup. Each row pairs an artist
-- with a performance time + stage for a specific festival.
--
-- Why a junction table instead of just packing names into the
-- description: typing "Kyle Falconer" in the admin form upserts
-- a real `artists` row (slugified, approved) so visitors get a
-- real /artists/kyle-falconer page that lists their festival
-- appearance. The lineup row links the two with the timing info.
--
-- An artist can appear at the same festival twice (e.g. soundcheck
-- at 4pm and headline at 9pm), so we don't enforce uniqueness
-- across (festival, artist). Distinct rows are fine.
--
-- ON DELETE CASCADE on both sides — deleting a festival or an
-- artist cleans up their lineup entries automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.festival_lineup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id uuid NOT NULL REFERENCES public.festivals(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  -- NULL = TBA. Otherwise full timestamp so we can sort
  -- chronologically and group by day on the public page.
  performance_time timestamptz,
  -- Free-text label: "Music Zone", "Main Stage", "Arena 2", etc.
  -- NULL when the festival has no concept of multiple stages.
  stage text,
  -- For acts with no performance_time, admin can still control order.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS festival_lineup_festival_idx
  ON public.festival_lineup(festival_id);
CREATE INDEX IF NOT EXISTS festival_lineup_artist_idx
  ON public.festival_lineup(artist_id);
-- Chronological ordering query — `WHERE festival_id = ? ORDER BY performance_time`
CREATE INDEX IF NOT EXISTS festival_lineup_time_idx
  ON public.festival_lineup(festival_id, performance_time NULLS LAST, sort_order);

ALTER TABLE public.festival_lineup ENABLE ROW LEVEL SECURITY;

-- Public-read so the festival landing page (server component, no auth
-- token) can load the lineup. Writes go through the admin server
-- actions which use the service client.
DROP POLICY IF EXISTS "festival_lineup_public_read" ON public.festival_lineup;
CREATE POLICY "festival_lineup_public_read"
  ON public.festival_lineup
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.festival_lineup IS
  'Per-festival typed-in lineup. Each row links a festival to an artist with a performance time + stage. Auto-creates artist rows on the fly when admin types a new name so each act gets a real /artists/<slug> page.';
