-- Festival drafts shouldn't leak.
--
-- Until now, festival events were just regular `events` rows linked
-- (via venue) to whatever venues admin had added to `festival_venues`.
-- There was no plumbing tying an event's public visibility to its
-- festival's `published` flag — so an admin uploading the lineup for
-- a draft festival immediately spilled every event onto the public
-- venue / artist / city pages.
--
-- This migration adds:
--   1. festivals.logo_url — square brand mark, separate from the wide
--      hero_image_url, so the festival admin tools and any future
--      compact festival display can show the right kind of image.
--   2. events.festival_id — nullable FK. When set, the event belongs
--      to that festival, and is only visible to the public when the
--      festival is published.
--   3. Updated public read policy on events that enforces the
--      festival-published rule. Service-role clients (admin tools,
--      cron) bypass RLS and still see everything; an admin SELECT
--      policy is added so admin server-side pages using the
--      authenticated client also see draft events.

-- ---- 1. Festival logo column -----------------------------------------------
ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS logo_url text;

-- ---- 2. Festival link on events --------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS festival_id uuid
  REFERENCES public.festivals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_festival_idx
  ON public.events(festival_id)
  WHERE festival_id IS NOT NULL;

-- ---- 3. Visibility: only published festivals expose their events ----------
-- Replace the existing public read policy. The new version preserves the
-- old approved-status check AND adds the festival visibility constraint.
DROP POLICY IF EXISTS "events: public read approved" ON public.events;
CREATE POLICY "events: public read approved"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (
    COALESCE(status, 'approved') = 'approved'
    AND (
      festival_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.festivals f
        WHERE f.id = events.festival_id AND f.published
      )
    )
  );

-- ---- 4. Admin SELECT bypass ------------------------------------------------
-- Without this, admins using the authenticated server client (most of the
-- admin pages) wouldn't see draft festival events on their own admin
-- screens. Service-role queries bypass RLS regardless; this policy is for
-- admin server components rendering with the user's auth cookies.
DROP POLICY IF EXISTS "events: admin read all" ON public.events;
CREATE POLICY "events: admin read all"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';
