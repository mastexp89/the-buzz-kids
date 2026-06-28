-- ----------------------------------------------------------------------------
-- 022: Festival preview tokens
-- ----------------------------------------------------------------------------
-- A per-festival opaque token that lets an unpublished festival be viewed
-- via /festivals/<slug>?preview=<token>. Used to send a sneak-peek URL to
-- prospective festival organisers (e.g. "here's what your page would look
-- like if you came on board") before they decide to go public.

ALTER TABLE festivals
  ADD COLUMN IF NOT EXISTS preview_token uuid NOT NULL DEFAULT gen_random_uuid();

-- Make sure existing rows get a token even though we set a default. Default
-- only applies on INSERT, so backfill anything that's NULL just in case.
UPDATE festivals SET preview_token = gen_random_uuid() WHERE preview_token IS NULL;

-- Allow public to read an unpublished festival when query matches the token.
-- We can't do this purely in RLS (the policy can't see query params), so the
-- check happens in the page handler instead. The existing "published" RLS
-- policy still applies for the published case. For the preview case, the
-- page handler will use the service-role client to fetch the festival.
