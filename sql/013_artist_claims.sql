-- ============================================================
-- The Buzz Guide: Artist claim flow.
-- Mirrors venue_claims. When an artist page has claimed_by=null
-- (auto-created from gigs / events / scraped posters), the artist or
-- their manager can click "Take ownership" to submit a claim.
-- Admin reviews + approves, which sets artists.claimed_by.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists artist_claims (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references artists(id) on delete cascade not null,
  claimant_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  role text,                       -- "Artist", "Band member", "Manager", "Booker"
  contact_phone text,
  contact_email text,
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text
);

create index if not exists artist_claims_artist_idx on artist_claims (artist_id);
create index if not exists artist_claims_user_idx on artist_claims (claimant_user_id);
create index if not exists artist_claims_pending_idx on artist_claims (status) where status = 'pending';

create unique index if not exists artist_claims_one_pending_per_user_per_artist
  on artist_claims (artist_id, claimant_user_id)
  where status = 'pending';

alter table artist_claims enable row level security;

drop policy if exists "artist_claims: claimant insert" on artist_claims;
create policy "artist_claims: claimant insert"
  on artist_claims for insert
  to authenticated
  with check (claimant_user_id = auth.uid());

drop policy if exists "artist_claims: claimant select" on artist_claims;
create policy "artist_claims: claimant select"
  on artist_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

drop policy if exists "artist_claims: claimant withdraw" on artist_claims;
create policy "artist_claims: claimant withdraw"
  on artist_claims for update
  to authenticated
  using (claimant_user_id = auth.uid() and status = 'pending')
  with check (claimant_user_id = auth.uid() and status in ('pending', 'withdrawn'));

drop policy if exists "artist_claims: admin all" on artist_claims;
create policy "artist_claims: admin all"
  on artist_claims for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Allow claimants to update their own artist after approval (so they can
-- edit their bio / socials / photo). The 003-artists.sql migration may
-- already cover this via "self_or_admin_update", so this policy is just a
-- safety net keyed on claimed_by.
drop policy if exists "artists: claimer update" on artists;
create policy "artists: claimer update"
  on artists for update
  to authenticated
  using (claimed_by = auth.uid())
  with check (claimed_by = auth.uid());

-- ============================================================
-- DONE.
-- ============================================================
