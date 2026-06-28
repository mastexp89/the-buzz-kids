-- ============================================================
-- The Buzz Guide: support artist / event_organiser roles + auto-set
-- role from signup metadata. Run this once in Supabase SQL editor.
-- Safe to re-run.
-- ============================================================

-- 1. Allow more values in profiles.role
do $$ begin
  -- Drop old check constraint if it exists, then add a wider one
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'profiles' and constraint_type = 'CHECK'
      and constraint_name like 'profiles_role%'
  ) then
    execute (
      select 'alter table profiles drop constraint ' || constraint_name
      from information_schema.table_constraints
      where table_name = 'profiles' and constraint_type = 'CHECK'
        and constraint_name like 'profiles_role%'
      limit 1
    );
  end if;
end $$;

alter table profiles
  add constraint profiles_role_check
  check (role in ('user','venue_owner','artist','event_organiser','admin'));

-- 2. Trigger function: when a new auth user is created, insert their profile
--    with role derived from raw_user_meta_data.account_type.
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

-- Wire the trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Backfill existing accounts that signed up as artists before this trigger
--    landed (their raw_user_meta_data.account_type tells us what they really are)
update public.profiles p
set role = 'artist'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'account_type' = 'artist'
  and p.role = 'venue_owner';

update public.profiles p
set role = 'event_organiser'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'account_type' = 'organiser'
  and p.role = 'venue_owner';

-- ============================================================
-- DONE. New behaviour:
--   * Artists/organisers now show their real role in /admin
--   * The trigger reads account_type from signup metadata
--   * Existing artist accounts have been re-classified
-- ============================================================
