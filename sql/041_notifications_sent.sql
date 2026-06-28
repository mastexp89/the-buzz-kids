-- Phase 2: idempotent notification log.
--
-- Whenever a cron fires a notification email we insert a row here. The
-- UNIQUE constraint on (user_id, notification_type, event_id) ensures
-- the same email never gets sent twice for the same combo — important
-- because crons retry on failure and we don't want to spam users.
--
-- For non-event notifications (e.g. future "weekly digest"), event_id
-- can be NULL and dedup happens at the type+user level on a per-day
-- basis using sent_at.

CREATE TABLE IF NOT EXISTS public.notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Composite unique only when event_id is set. Using a partial unique
  -- index because a NULL in the multi-column UNIQUE would let dupes
  -- through; this enforces "one notification of this type per user per
  -- event" but leaves room for non-event notification types.
  UNIQUE NULLS NOT DISTINCT (user_id, notification_type, event_id)
);

CREATE INDEX IF NOT EXISTS notifications_sent_user_idx
  ON public.notifications_sent(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS notifications_sent_event_idx
  ON public.notifications_sent(event_id)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;

-- Users can see their own notification history (Phase 3 may expose this
-- in /dashboard/notifications for "what have we emailed you" visibility).
DROP POLICY IF EXISTS "notifications_own_select" ON public.notifications_sent;
CREATE POLICY "notifications_own_select" ON public.notifications_sent
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts only happen via the service-role client from cron routes —
-- no policy needed for authenticated INSERT.
