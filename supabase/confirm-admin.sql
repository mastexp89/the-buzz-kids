-- Dev helper: confirm the admin accounts so you can sign in WITHOUT the email
-- link (email sending isn't wired up yet), and make them admins. Safe to re-run.
-- Run in Supabase → SQL Editor.

-- 1. Mark the email as confirmed so sign-in works.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) in ('hello@thebuzzkids.co.uk', 'david@thebuzzkids.co.uk', 'admin@thebuzzkids.co.uk');

-- 2. Promote them to admin (in case migration 071 wasn't run before they signed up).
update public.profiles
set role = 'admin'
where lower(email) in ('hello@thebuzzkids.co.uk', 'david@thebuzzkids.co.uk', 'admin@thebuzzkids.co.uk');
