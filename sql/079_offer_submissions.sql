-- ============================================================
-- The Buzz Kids: let anyone suggest a deal (no account).
-- Public submissions come in as approved = false (pending) and an
-- admin approves them before they show. Store the submitter's email
-- (optional) so we can follow up.
-- Run once in Supabase SQL editor (after 077/078). Safe to re-run.
-- ============================================================

alter table public.offers
  add column if not exists submitted_email text;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
