-- Telegram notifications for EVERY new signup — website AND mobile app.
--
-- App signups talk straight to Supabase Auth and never touch the web
-- server, so the server-side Telegram ping can't see them. Every signup
-- (web or app) creates a public.profiles row via the on_auth_user_created
-- trigger, so a trigger THERE catches them all. The website's own Telegram
-- signup pings have been removed in favour of this single source.
--
-- BEFORE RUNNING: replace REPLACE_WITH_TELEGRAM_WEBHOOK_SECRET below with
-- the TELEGRAM_WEBHOOK_SECRET value from the Vercel project. NEVER commit
-- the real value — this repo is public.
-- Run in the Buzz Kids Supabase SQL editor.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_new_signup_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://www.thebuzzkids.co.uk/api/hooks/new-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', 'REPLACE_WITH_TELEGRAM_WEBHOOK_SECRET'
    ),
    body := jsonb_build_object('record', jsonb_build_object(
      'id', new.id,
      'email', new.email,
      'display_name', new.display_name,
      'role', new.role
    ))
  );
  return new;
end;
$$;

drop trigger if exists profiles_signup_telegram on public.profiles;
create trigger profiles_signup_telegram
  after insert on public.profiles
  for each row
  execute function public.notify_new_signup_telegram();
