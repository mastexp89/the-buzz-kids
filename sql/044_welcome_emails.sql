-- ----------------------------------------------------------------------------
-- 044: Welcome-email queue (post email-confirmation)
-- ----------------------------------------------------------------------------
-- Supabase Auth's built-in flow sends a confirmation email to verify the
-- address. Once they click that link, `auth.users.email_confirmed_at` flips
-- from NULL to a timestamp. That's the right moment to send a tailored
-- "welcome" email pointing the user at what they can do — favourite venues
-- (fan), claim a page (venue/artist/organiser owner), etc.
--
-- We don't send from inside the trigger directly — Postgres triggers can't
-- comfortably make HTTPS calls without pg_net. Instead we enqueue a row in
-- pending_welcome_emails; a small cron drains the queue every few minutes,
-- calls Resend, and marks the row sent_at.
--
-- The queue is keyed on user_id (PK) so each user gets at most one welcome
-- email — protects against a race where the user re-confirms after an
-- email change.

CREATE TABLE IF NOT EXISTS public.pending_welcome_emails (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  account_type   text        NOT NULL DEFAULT 'user',
  queued_at      timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  send_attempts  int         NOT NULL DEFAULT 0,
  last_error     text
);

CREATE INDEX IF NOT EXISTS pending_welcome_emails_unsent_idx
  ON public.pending_welcome_emails (queued_at)
  WHERE sent_at IS NULL;

-- Trigger function: when email_confirmed_at goes from NULL to set, queue.
-- account_type comes from raw_user_meta_data (set during signup) — falls
-- back to "user" (the default fan role) when missing, matching the role
-- mapping in sql/042.
CREATE OR REPLACE FUNCTION public.queue_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.pending_welcome_emails (user_id, email, account_type)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'account_type', 'user')
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_queue_welcome_email ON auth.users;
CREATE TRIGGER auth_users_queue_welcome_email
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_welcome_email();

-- Lock the table down — only the service role drains the queue.
ALTER TABLE public.pending_welcome_emails ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated, which is what we want.

NOTIFY pgrst, 'reload schema';
