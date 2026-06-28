-- Phase 1: punter favourites + notification preferences.
--
-- One table covers favourites of every entity type. target_type tells
-- us which (venue / artist / organiser / event) and target_id points
-- at the corresponding row. We don't use FKs for target_id because it
-- references four different tables — application logic handles
-- referential cleanup via a delete cascade hook on each entity table.
--
-- notification_prefs is a small jsonb blob on profiles so we don't
-- need a separate table for "user X wants email Y". Defaults to
-- everything on; Phase 2 adds a UI to toggle each.

CREATE TABLE IF NOT EXISTS public.favourites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('venue', 'artist', 'organiser', 'event')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS favourites_user_type_idx
  ON public.favourites(user_id, target_type);
CREATE INDEX IF NOT EXISTS favourites_target_idx
  ON public.favourites(target_type, target_id);

-- ---- RLS --------------------------------------------------------------------
-- A favourite is private to the user who created it. Phase 2 may relax this
-- for social features (e.g. "show me who else is going") but that's later.
ALTER TABLE public.favourites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favourites_own_select" ON public.favourites;
CREATE POLICY "favourites_own_select" ON public.favourites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "favourites_own_insert" ON public.favourites;
CREATE POLICY "favourites_own_insert" ON public.favourites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "favourites_own_delete" ON public.favourites;
CREATE POLICY "favourites_own_delete" ON public.favourites
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---- Notification preferences ---------------------------------------------
-- jsonb blob keyed by notification category. Default all true; users opt out
-- via the (Phase 2) preferences page. New categories added later default to
-- true unless explicitly set to false in the user's row.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb
  NOT NULL DEFAULT '{
    "new_gig_at_favourite_venue": true,
    "new_gig_with_favourite_artist": true,
    "new_gig_from_favourite_organiser": true,
    "morning_of_reminder": true,
    "fifteen_minute_reminder": true
  }'::jsonb;
