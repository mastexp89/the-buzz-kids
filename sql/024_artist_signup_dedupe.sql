-- ============================================================
-- 024: Don't auto-create an artist row on signup if a similar
--      *unclaimed* artist already exists.
--
-- Why: stops users creating duplicate pages for bands that already
--      have unclaimed entries in the directory. After signup we
--      route them through /dashboard/setup so they can either
--      claim the existing page or create a new one with a
--      double-check.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  acct text := COALESCE(meta->>'account_type', 'venue');
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
    ELSE 'venue_owner'
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
  -- artist with a matching normalised name. The /dashboard/setup page will
  -- then offer them to claim that one (or override and create new).
  IF acct = 'artist' THEN
    artist_name := NULLIF(TRIM(COALESCE(meta->>'display_name', new.email)), '');
    IF artist_name IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.artists WHERE claimed_by = new.id
    ) THEN
      norm_name := LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(artist_name, '^the\s+', '', 'i'),
        '[^a-z0-9]+', '', 'g'
      ));

      -- Is there an unclaimed artist with a similar normalised name?
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
        -- Safe to auto-create — no ambiguity
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
      -- Else: leave them without an auto-created artist; they hit the
      -- /dashboard/setup wizard next where they can claim the existing one
      -- or override with create-new.
    END IF;
  END IF;

  RETURN new;
END;
$$;
