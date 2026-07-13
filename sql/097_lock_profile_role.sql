-- ============================================================
-- SECURITY FIX (critical): stop privilege escalation via profiles.role
--
-- The `profiles_self_update` RLS policy lets a user update their own row, and
-- its WITH CHECK only verifies the row still belongs to them — NOT which
-- columns change. So any signed-in user could:
--     PATCH /rest/v1/profiles?id=eq.<their-id>   { "role": "admin" }
-- and grant themselves full admin access (admin tools trust profiles.role).
--
-- This trigger pins `role` on UPDATE: only an admin (acting in their own
-- session) or the service_role (server-side admin tools) may change it. An
-- unauthorised attempt is silently reverted, so the user's legitimate edits
-- (display name, avatar, notification prefs) still save normally.
--
-- Signup is unaffected: new profiles are INSERTed (this is a BEFORE UPDATE
-- trigger), and the admin "change role" tool runs as the service_role.
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

create or replace function public.lock_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    new.role := old.role;  -- silently revert an unauthorised role change
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_role on public.profiles;
create trigger profiles_lock_role
  before update on public.profiles
  for each row
  execute function public.lock_profile_role();

-- ============================================================
-- DONE. After running, a non-admin PATCH setting role='admin' is a no-op
-- (their row saves, but role stays 'user'). Verify: sign in as a test 'user',
-- try the PATCH above with their token — role should remain 'user'.
-- ============================================================
