-- ============================================================
-- The Buzz Guide: when someone signs up as account_type=artist, also
-- create a matching row in the artists directory keyed to them
-- (claimed_by=user_id, approved=true), so they appear on /artists
-- and can be linked to events via event_artists.
--
-- Also backfills existing artist accounts that signed up before
-- this trigger landed but never got an artists row.
--
-- Safe to re-run.
-- ============================================================

-- 1. Replace handle_new_user trigger function with one that also
--    inserts the matching artists row for artist accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  acct text := coalesce(meta->>'account_type', 'venue');
  resolved_role text;
  artist_name text;
  base_slug text;
  candidate_slug text;
  attempt int := 0;
begin
  resolved_role := case acct
    when 'artist'    then 'artist'
    when 'organiser' then 'event_organiser'
    when 'venue'     then 'venue_owner'
    else 'venue_owner'
  end;

  insert into public.profiles (id, email, display_name, role, created_at)
  values (
    new.id,
    new.email,
    coalesce(meta->>'display_name', null),
    resolved_role,
    now()
  )
  on conflict (id) do update
    set
      email = excluded.email,
      display_name = coalesce(excluded.display_name, profiles.display_name),
      role = case
        when profiles.role in ('venue_owner','user') then excluded.role
        else profiles.role
      end;

  -- For artist signups, also create their public artist page so they
  -- show up on the directory immediately. Skip if they already have
  -- one claimed (e.g. they signed up before the trigger landed and
  -- the backfill below already handled them).
  if acct = 'artist' then
    artist_name := nullif(trim(coalesce(meta->>'display_name', new.email)), '');
    if artist_name is not null and not exists (
      select 1 from public.artists where claimed_by = new.id
    ) then
      base_slug := regexp_replace(
        regexp_replace(
          lower(replace(artist_name, '&', 'and')),
          '[^a-z0-9\s-]', '', 'g'
        ),
        '\s+', '-', 'g'
      );
      base_slug := regexp_replace(base_slug, '-+', '-', 'g');
      base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
      base_slug := substring(base_slug for 100);
      if base_slug = '' then
        base_slug := 'artist';
      end if;

      candidate_slug := base_slug;
      while attempt < 8 loop
        begin
          insert into public.artists (name, slug, claimed_by, approved)
          values (artist_name, candidate_slug, new.id, true);
          exit;
        exception when unique_violation then
          attempt := attempt + 1;
          candidate_slug := base_slug || '-' || (attempt + 1)::text;
        end;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

-- 2. Backfill existing artist accounts that don't have an artists row yet.
do $$
declare
  rec record;
  base_slug text;
  candidate_slug text;
  attempt int;
begin
  for rec in
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.email) as artist_name
    from public.profiles p
    left join public.artists a on a.claimed_by = p.id
    where p.role = 'artist' and a.id is null
      and coalesce(nullif(trim(p.display_name), ''), p.email) is not null
  loop
    base_slug := regexp_replace(
      regexp_replace(
        lower(replace(rec.artist_name, '&', 'and')),
        '[^a-z0-9\s-]', '', 'g'
      ),
      '\s+', '-', 'g'
    );
    base_slug := regexp_replace(base_slug, '-+', '-', 'g');
    base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
    base_slug := substring(base_slug for 100);
    if base_slug = '' then base_slug := 'artist'; end if;

    candidate_slug := base_slug;
    attempt := 0;
    while attempt < 8 loop
      begin
        insert into public.artists (name, slug, claimed_by, approved)
        values (rec.artist_name, candidate_slug, rec.id, true);
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        candidate_slug := base_slug || '-' || (attempt + 1)::text;
      end;
    end loop;
  end loop;
end $$;

-- ============================================================
-- DONE. New behaviour:
--   * Signing up as account_type=artist auto-creates an artists
--     row claimed by that user, appearing on /artists immediately.
--   * Existing artist accounts that were missing a directory page
--     have been backfilled (one row per profile).
-- ============================================================
