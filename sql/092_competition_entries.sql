-- Circus Extreme competition: enter by having a (confirmed) Buzz Kids account.
-- One entry row per account per competition. Service-role only — the enter
-- action + draw run server-side. Run this whole file in the Supabase SQL editor.

create table if not exists competition_entries (
  id               uuid primary key default gen_random_uuid(),
  competition_slug text not null,
  user_id          uuid not null references profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (competition_slug, user_id)
);

create index if not exists competition_entries_slug on competition_entries (competition_slug);

alter table competition_entries enable row level security;
