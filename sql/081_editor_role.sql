-- ============================================================
-- The Buzz Kids: add the restricted 'editor' (contributor) role.
--
-- Editors can add places, events and deals (auto-approved) but have no
-- other admin powers. The profiles.role CHECK constraint (from 008) only
-- allowed user/venue_owner/artist/event_organiser/admin, so any attempt
-- to set role = 'editor' (the admin "Add account" form, "Make editor"
-- button) failed the constraint and silently fell back to venue_owner.
--
-- This migration:
--   1. Widens profiles_role_check to allow 'editor'.
--   2. Teaches handle_new_user() to map account_type 'editor'/'admin' so
--      admin-created accounts land with the right role on first insert.
--   3. Backfills anyone created as an editor who got stuck as venue_owner.
--
-- Safe to re-run.
-- ============================================================

-- 1. Widen the role CHECK constraint to include 'editor'.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user','venue_owner','artist','event_organiser','admin','editor'));

-- 2. Map the new account_type values onto roles at signup/insert time.
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
  resolved_role := case acct
    when 'artist'    then 'artist'
    when 'organiser' then 'event_organiser'
    when 'venue'     then 'venue_owner'
    when 'fan'       then 'user'
    when 'editor'    then 'editor'
    when 'admin'     then 'admin'
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
      -- only overwrite role if the existing one is still a default
      role = case
        when profiles.role in ('venue_owner','user') then excluded.role
        else profiles.role
      end;

  return new;
end;
$$;

-- 3. Backfill: accounts whose signup metadata says 'editor' but whose
--    profile role got stuck as venue_owner (created before this fix).
update public.profiles p
set role = 'editor'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'account_type' = 'editor'
  and p.role = 'venue_owner';

-- ============================================================
-- DONE. After running this:
--   * role = 'editor' is now allowed.
--   * "Make editor" / "Add account (editor)" work.
--   * Any editor account stuck as venue_owner is corrected.
-- ============================================================
