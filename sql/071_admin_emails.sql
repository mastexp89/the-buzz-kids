-- 071_admin_emails.sql  (The Buzz Kids)
-- Admin allowlist: these email addresses are automatically given the 'admin'
-- role when their account is created (and any matching account that already
-- exists is promoted now). Edit the list below to add/remove admins.
--
-- SECURITY: this trusts the email address, so keep "Confirm email" ON in
-- Supabase Auth (Authentication → Providers → Email) in production — otherwise
-- someone could sign up with an admin address they don't control.

create or replace function public.apply_admin_allowlist()
returns trigger as $$
begin
  if lower(new.email) in (
    'hello@thebuzzkids.co.uk',
    'david@thebuzzkids.co.uk'
  ) then
    new.role := 'admin';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_admin_allowlist on public.profiles;
create trigger profiles_admin_allowlist
  before insert or update of email on public.profiles
  for each row execute function public.apply_admin_allowlist();

-- Promote any of these accounts that already exist.
update public.profiles
set role = 'admin'
where lower(email) in (
  'hello@thebuzzkids.co.uk',
  'david@thebuzzkids.co.uk'
);
