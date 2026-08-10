-- Telegram notifications for MOBILE APP edit-suggestion submissions.
--
-- The app inserts into edit_suggestions directly with the anon key (see the
-- app repo's 088_app_public_submissions.sql), bypassing the web server — so
-- the server-side Telegram notify never fires for those rows. This adds:
--   1. a `source` column — the website's server actions now write 'web';
--      app rows keep the default 'app'
--   2. a pg_net trigger that POSTs app rows to the site's
--      /api/hooks/edit-suggestion endpoint, which pings the admins group
--      with the usual "Mark done" card.
--
-- BEFORE RUNNING: replace REPLACE_WITH_TELEGRAM_WEBHOOK_SECRET below with
-- the TELEGRAM_WEBHOOK_SECRET value from the Vercel project.
-- Run in the Buzz Kids Supabase SQL editor.

create extension if not exists pg_net with schema extensions;

alter table public.edit_suggestions
  add column if not exists source text not null default 'app';

create or replace function public.notify_app_edit_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://www.thebuzzkids.co.uk/api/hooks/edit-suggestion',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', 'REPLACE_WITH_TELEGRAM_WEBHOOK_SECRET'
    ),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists edit_suggestions_app_telegram on public.edit_suggestions;
create trigger edit_suggestions_app_telegram
  after insert on public.edit_suggestions
  for each row
  when (new.source = 'app')
  execute function public.notify_app_edit_suggestion();
