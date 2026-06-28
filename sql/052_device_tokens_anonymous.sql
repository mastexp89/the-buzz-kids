-- ============================================================
-- 052: Anonymous device tokens
--
-- Lets the mobile app register its Expo push token BEFORE the user
-- signs in (or even creates an account). Existing flow only stored
-- tokens linked to a user_id; the new flow stores user_id = NULL for
-- anonymous devices and upgrades them to a real user_id later when
-- the user signs in (UPSERT on expo_token).
--
-- Use case: admin broadcasts to "everyone with the app" — including
-- the long tail of users who downloaded but never registered.
--
-- RLS: anonymous rows can't be inserted via the JS client (RLS would
-- block them — the INSERT policy requires auth.uid() = user_id which
-- is impossible when user_id is NULL). Anonymous inserts must go
-- through the /api/push/register endpoint which uses the service
-- client to bypass RLS. The endpoint itself is open (no Bearer
-- required), which is fine — the worst a hostile actor could do is
-- register a junk Expo token, and Expo's push API quietly drops
-- DeviceNotRegistered.
-- ============================================================

ALTER TABLE public.device_tokens
  ALTER COLUMN user_id DROP NOT NULL;

-- Existing user_idx is fine for user-linked rows; add a partial index
-- for the "find all anonymous tokens" query the broadcast uses.
CREATE INDEX IF NOT EXISTS device_tokens_anonymous_idx
  ON public.device_tokens(last_seen_at)
  WHERE user_id IS NULL;

COMMENT ON COLUMN public.device_tokens.user_id IS
  'Owner of this device token. NULL = anonymous registration (app installed but not signed in). Becomes set when the user signs in and the mobile app re-registers the same expo_token with Bearer auth.';
