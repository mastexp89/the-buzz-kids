-- ============================================================
-- 062: Festival sponsors
--
-- Per-festival list of extra sponsors. The existing flat columns
-- on festivals (sponsor_name / sponsor_logo_url / sponsor_url)
-- stay put as the ONE headline sponsor — this table is for the
-- "With thanks to" grid of additional supporters below it.
--
-- Why a separate table instead of a JSON array on festivals:
--   • Logo URLs are user-uploaded via the admin's ImageUploader.
--     Storing them as separate rows means each sponsor's logo can
--     be re-uploaded / replaced without rewriting the whole festival
--     row.
--   • Display order is mutable — admin can drag to reorder. A
--     dedicated row with a sort_order int makes that a one-row
--     UPDATE instead of a re-serialise of a JSON array.
--   • Future: per-sponsor click tracking would need its own ID.
--
-- ON DELETE CASCADE — deleting a festival drops its sponsors.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.festival_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id uuid NOT NULL REFERENCES public.festivals(id) ON DELETE CASCADE,
  -- Display name shown under (or as alt text on) the logo.
  -- Required because some logos are illegible without a label,
  -- and screen readers / fallback rendering need it.
  name text NOT NULL,
  -- The sponsor's logo image. Optional — if missing we'll just
  -- render the name as text on the public page.
  logo_url text,
  -- Where to link to when someone clicks the logo. Optional —
  -- if missing the logo renders as a non-clickable image.
  url text,
  -- Admin-controlled order. Lower numbers render first. Multiple
  -- rows can share a value; we just fall back to created_at as a
  -- stable secondary sort.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS festival_sponsors_festival_idx
  ON public.festival_sponsors(festival_id);
-- Ordering query — `WHERE festival_id = ? ORDER BY sort_order, created_at`
CREATE INDEX IF NOT EXISTS festival_sponsors_order_idx
  ON public.festival_sponsors(festival_id, sort_order, created_at);

ALTER TABLE public.festival_sponsors ENABLE ROW LEVEL SECURITY;

-- Public-read so the festival landing page (server component, no auth
-- token) can load the sponsor grid. Writes go through the admin
-- server actions which use the service client.
DROP POLICY IF EXISTS "festival_sponsors_public_read" ON public.festival_sponsors;
CREATE POLICY "festival_sponsors_public_read"
  ON public.festival_sponsors
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.festival_sponsors IS
  'Extra sponsors for a festival (the "with thanks to" grid). The headline sponsor stays as the flat sponsor_name/sponsor_logo_url/sponsor_url columns on the festivals table.';
