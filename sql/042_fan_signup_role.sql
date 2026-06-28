-- Fix: signup trigger mapped account_type='fan' to role='venue_owner'.
--
-- The CASE in handle_new_user_account_type (sql/024) only knew about
-- artist / organiser / venue and had an ELSE clause that fell through
-- to venue_owner — so every "Just a fan" signup landed in the profiles
-- table with role='venue_owner'. The user shows up in admin as a venue
-- when they're really a punter who just wants to favourite gigs.
--
-- This migration:
--   1. Replaces the trigger function with one that knows about 'fan'
--      and defaults unknown values to the lightweight 'user' role
--      (which is what fans should be).
--   2. Backfills profiles where raw_user_meta_data.account_type = 'fan'
--      but role was incorrectly set to venue_owner.

CREATE OR REPLACE FUNCTION public.handle_new_user_account_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  acct text := COALESCE(meta->>'account_type', 'fan');
  resolved_role text;
  artist_name text;
  norm_name text;
  base_slug text;
  candidate_slug text;
  attempt int := 0;
  has_similar_unclaimed boolean;
BEGIN
  resolved_role := CASE acct
    WHEN 'artist'    THEN 'artist'
    WHEN 'organiser' THEN 'event_organiser'
    WHEN 'venue'     THEN 'venue_owner'
    WHEN 'fan'       THEN 'user'
    ELSE 'user'  -- safer default — fans don't accidentally inherit ownership perms
  END;

  INSERT INTO public.profiles (id, email, display_name, role, created_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(meta->>'display_name', NULL),
    resolved_role,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email = excluded.email,
      display_name = COALESCE(excluded.display_name, profiles.display_name),
      role = CASE
        WHEN profiles.role IN ('venue_owner','user') THEN excluded.role
        ELSE profiles.role
      END;

  -- For artist signups: skip auto-create if there's already an unclaimed
  -- artist with a matching normalised name. (Behaviour unchanged from 024.)
  IF acct = 'artist' THEN
    artist_name := NULLIF(TRIM(COALESCE(meta->>'display_name', new.email)), '');
    IF artist_name IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.artists WHERE claimed_by = new.id
    ) THEN
      norm_name := LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(artist_name, '^the\s+', '', 'i'),
        '[^a-z0-9]+', '', 'g'
      ));

      SELECT EXISTS (
        SELECT 1 FROM public.artists a
        WHERE a.claimed_by IS NULL
          AND LENGTH(norm_name) >= 3
          AND LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(a.name, '^the\s+', '', 'i'),
                '[^a-z0-9]+', '', 'g'
              )) = norm_name
      ) INTO has_similar_unclaimed;

      IF NOT has_similar_unclaimed THEN
        base_slug := regexp_replace(
          regexp_replace(
            lower(replace(artist_name, '&', 'and')),
            '[^a-z0-9\s-]', '', 'g'
          ),
          '\s+', '-', 'g'
        );
        base_slug := regexp_replace(base_slug, '-+', '-', 'g');
        base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
        base_slug := substring(base_slug FOR 100);
        IF base_slug = '' THEN
          base_slug := 'artist';
        END IF;

        candidate_slug := base_slug;
        WHILE attempt < 8 LOOP
          BEGIN
            INSERT INTO public.artists (name, slug, claimed_by, approved)
            VALUES (artist_name, candidate_slug, new.id, true);
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            attempt := attempt + 1;
            candidate_slug := base_slug || '-' || (attempt + 1)::text;
          END;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- Backfill: anyone whose auth.users row says they signed up as a fan
-- but whose profile got mis-classified as venue_owner should be 'user'.
-- (We don't touch venue_owners who are real venue owners — the metadata
-- check ensures we only fix the bug victims.)
UPDATE public.profiles p
SET role = 'user'
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'venue_owner'
  AND COALESCE(u.raw_user_meta_data->>'account_type', '') = 'fan';
