-- ============================================================
-- The Buzz Guide: fix fan signups being mis-classified as venue_owner.
--
-- Background: the handle_new_user() trigger added in 008 maps the
-- account_type from signup metadata onto profiles.role. The case
-- statement only handled 'artist' / 'organiser' / 'venue' — anything
-- else (including 'fan', which was added later as a signup option)
-- fell into the `else` branch and got written as 'venue_owner'.
--
-- This migration:
--   1. Updates the trigger to map 'fan' → 'user' (fans are just regular
--      users in the system — no special role chip needed).
--   2. Backfills any existing fan accounts that were mis-labelled as
--      venue_owner by looking at their auth.users metadata.
--
-- Safe to re-run.
-- ============================================================

-- 1. Re-create the trigger function with 'fan' handled explicitly.
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
begin
  -- Map account_type from signup form to a real role
  resolved_role := case acct
    when 'artist'    then 'artist'
    when 'organiser' then 'event_organiser'
    when 'venue'     then 'venue_owner'
    when 'fan'       then 'user'
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
      -- only overwrite role if the existing one is still the default
      role = case
        when profiles.role in ('venue_owner','user') then excluded.role
        else profiles.role
      end;

  return new;
end;
$$;

-- 2. Backfill: any account whose signup metadata says 'fan' but whose
--    profile role is still the default 'venue_owner' should be 'user'.
update public.profiles p
set role = 'user'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'account_type' = 'fan'
  and p.role = 'venue_owner';

-- ============================================================
-- DONE. New behaviour:
--   * Fan signups now correctly land as role = 'user' in profiles
--   * Existing mis-classified fan accounts have been re-labelled
--   * Admin user list will show them as "user" instead of "venue"
-- ============================================================
