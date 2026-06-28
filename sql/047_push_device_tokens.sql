-- ============================================================
-- 047: Expo push device tokens
--
-- Stores one row per (user, device) so we know where to deliver
-- push notifications from the mobile app. The mobile app calls
-- POST /api/push/register on login (and after token refresh) to
-- upsert its token here.
--
-- Token format: "ExponentPushToken[xxxxxxxxxxxxx]" (Expo standard)
--
-- Sends are best-effort and de-duplicated by Expo's push receipts —
-- if a token starts returning "DeviceNotRegistered" we delete the
-- row from src/lib/push.ts so we stop sending to dead devices.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token  text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- One row per device (token is the device identity). If two users
  -- sign into the same device the second signup "steals" the token.
  UNIQUE (expo_token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx
  ON public.device_tokens(user_id);

-- ---- RLS --------------------------------------------------------------------
-- Users can read / delete only their own tokens. Inserts happen via the
-- API endpoint with Bearer JWT auth so the user_id check is enforced
-- in the route handler too.
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_tokens_own_select" ON public.device_tokens;
CREATE POLICY "device_tokens_own_select" ON public.device_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_insert" ON public.device_tokens;
CREATE POLICY "device_tokens_own_insert" ON public.device_tokens
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_update" ON public.device_tokens;
CREATE POLICY "device_tokens_own_update" ON public.device_tokens
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_delete" ON public.device_tokens;
CREATE POLICY "device_tokens_own_delete" ON public.device_tokens
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.device_tokens IS
  'Expo push tokens registered by the mobile app on login. One row per device. Service role uses these to fan out push notifications via Expo''s push API; see src/lib/push.ts.';
