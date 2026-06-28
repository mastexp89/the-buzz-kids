-- ============================================================
-- 058: FB scrape per-venue run log
--
-- Logs one row per (venue, cron iteration) so the admin can see WHY
-- a day produced 0 events: did Apify return no posts, did Anthropic
-- error, did the AI find nothing, or did dedup catch every extraction?
--
-- The cron's response already carries `perVenue: [{venue, posts,
-- events, skipped, error}]` but it's only in-memory — once the chain
-- finishes there's no record of what happened where. Persisting to
-- this table fills the gap.
--
-- Volume estimate: 253 venues × 2 scheduled runs/week ≈ 26k rows/year,
-- plus manual triggers. Tiny by Postgres standards. Index on ran_at
-- so the dashboard's daily-rollup query is fast.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fb_scrape_venue_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  -- NULL when the venue has since been deleted — keep the row for
  -- the historical record but don't cascade-delete it.
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  -- Snapshot the name so the row remains readable even if venue_id
  -- goes NULL or the venue is renamed.
  venue_name text NOT NULL,
  -- For city-scoped daily aggregates (no expensive joins needed).
  city_slug text,
  -- Counts from the cron's per-venue summary.
  posts int NOT NULL DEFAULT 0,
  events_created int NOT NULL DEFAULT 0,
  events_skipped int NOT NULL DEFAULT 0,
  -- Error message from extractEvents / scrapeVenueFacebook, NULL when
  -- the venue processed cleanly. Truncated to 1000 chars at insert.
  error text,
  -- Was this run triggered with ?force=1 (bypassing the 12h cooldown)?
  -- Lets us tell scheduled runs apart from manual debug triggers.
  forced boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_ran_at_idx
  ON public.fb_scrape_venue_runs(ran_at DESC);
CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_venue_idx
  ON public.fb_scrape_venue_runs(venue_id);
-- Partial index: rows with errors, ordered newest-first. Lets the
-- dashboard's "today's errors" query stay fast even as the table grows.
CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_errors_idx
  ON public.fb_scrape_venue_runs(ran_at DESC)
  WHERE error IS NOT NULL;

ALTER TABLE public.fb_scrape_venue_runs ENABLE ROW LEVEL SECURITY;

-- Admin-only read. Writes go through the cron route's service client
-- which bypasses RLS, so the policy is belt-and-braces.
DROP POLICY IF EXISTS "fb_scrape_venue_runs_admin_read" ON public.fb_scrape_venue_runs;
CREATE POLICY "fb_scrape_venue_runs_admin_read"
  ON public.fb_scrape_venue_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

COMMENT ON TABLE public.fb_scrape_venue_runs IS
  'Per-venue run log for the FB scrape cron. One row per (venue, cron iteration). Powers the daily Skipped / Errors columns on /admin/cron-runs and lets admins spot-check why a day produced 0 events.';

notify pgrst, 'reload schema';
