-- ============================================================
-- The Buzz Guide: artist gig submissions + admin approval pipeline
-- Run this whole file once in Supabase SQL editor.
-- Safe to re-run (uses IF NOT EXISTS / DO blocks where possible).
-- ============================================================

-- 1. events.status (pending | approved | rejected) + submitted_by
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='events' and column_name='status') then
    alter table events add column status text not null default 'approved'
      check (status in ('pending','approved','rejected'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name='events' and column_name='submitted_by') then
    alter table events add column submitted_by uuid references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='events' and column_name='reviewed_at') then
    alter table events add column reviewed_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='events' and column_name='reviewed_by') then
    alter table events add column reviewed_by uuid references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists events_status_idx on events(status);
create index if not exists events_submitted_by_idx on events(submitted_by);

-- 2. venue_suggestions: when artist submits a gig at an unlisted venue
create table if not exists venue_suggestions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references auth.users(id) on delete set null,

  -- venue claim
  venue_name text not null,
  city_id uuid references cities(id),
  address text,
  postcode text,
  website text,

  -- gig details
  gig_title text,
  gig_start_time timestamptz,
  gig_end_time timestamptz,
  gig_cover_charge text,
  gig_ticket_url text,
  gig_image_url text,
  gig_description text,

  -- contact
  submitter_name text,
  submitter_contact text,

  -- everything else
  extras jsonb default '{}'::jsonb,

  status text not null default 'pending'
    check (status in ('pending','converted','rejected')),
  -- when an admin promotes this suggestion into a real venue + event
  converted_venue_id uuid references venues(id) on delete set null,
  converted_event_id uuid references events(id) on delete set null,

  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists venue_suggestions_status_idx on venue_suggestions(status);
create index if not exists venue_suggestions_created_idx on venue_suggestions(created_at desc);

-- 3. RLS policies for venue_suggestions
alter table venue_suggestions enable row level security;

drop policy if exists "venue_suggestions: insert by signed-in users" on venue_suggestions;
create policy "venue_suggestions: insert by signed-in users"
  on venue_suggestions for insert
  to authenticated
  with check (auth.uid() = submitted_by);

drop policy if exists "venue_suggestions: own row select" on venue_suggestions;
create policy "venue_suggestions: own row select"
  on venue_suggestions for select
  to authenticated
  using (auth.uid() = submitted_by);

drop policy if exists "venue_suggestions: admin read all" on venue_suggestions;
create policy "venue_suggestions: admin read all"
  on venue_suggestions for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "venue_suggestions: admin write" on venue_suggestions;
create policy "venue_suggestions: admin write"
  on venue_suggestions for update
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "venue_suggestions: admin delete" on venue_suggestions;
create policy "venue_suggestions: admin delete"
  on venue_suggestions for delete
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 4. Update events RLS so artists can insert pending gigs at approved venues
-- (existing policy probably restricts to venue owners only — add a parallel one)
drop policy if exists "events: artist submission" on events;
create policy "events: artist submission"
  on events for insert
  to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from venues v
      where v.id = events.venue_id
        and v.approved = true
    )
  );

-- Artists can read their own pending submissions
drop policy if exists "events: read own submissions" on events;
create policy "events: read own submissions"
  on events for select
  to authenticated
  using (submitted_by = auth.uid());

-- Public/approved selects already exist; harden them so pending gigs don't leak
-- (anon role only sees status='approved' OR null-status legacy rows)
drop policy if exists "events: public read approved" on events;
create policy "events: public read approved"
  on events for select
  to anon, authenticated
  using (
    coalesce(status, 'approved') = 'approved'
  );

-- 5. Default new self-registered artists to unapproved
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='artists' and column_name='approved') then
    alter table artists alter column approved set default false;
  end if;
end $$;

-- Existing artist rows are already approved (we trust seed data) — leave them alone.
-- If you want a stricter sweep, run:
--   update artists set approved = false where claimed_by is null and created_at > '2025-01-01';

-- ============================================================
-- DONE. New behaviour:
--   * Public lists hide events where status='pending' or 'rejected'
--   * Artists can submit pending gigs at any approved venue
--   * Unlisted-venue gigs land in venue_suggestions for admin review
--   * Auto-created artists are unapproved by default until you OK them
-- ============================================================
