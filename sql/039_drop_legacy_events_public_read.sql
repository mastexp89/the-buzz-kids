-- Drop the legacy events_public_read policy.
--
-- This policy was created outside the migration files (probably via the
-- Supabase dashboard at some point) and grants public SELECT to every
-- event whose venue exists — no status check, no festival visibility
-- check. RLS policies on the same operation are OR'd, so this policy
-- was silently overriding the festival_id visibility filter that
-- sql/036 added: draft-festival events were appearing on the public
-- site even though the proper "events: public read approved" policy
-- would have hidden them.
--
-- The intended public read policy is "events: public read approved"
-- (with the spaces + colons in its name) — that one DOES include both
-- the status and festival visibility checks, so dropping the legacy
-- duplicate is safe.

DROP POLICY IF EXISTS "events_public_read" ON public.events;
