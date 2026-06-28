-- ============================================================
-- The Buzz Guide: Venue claim flow.
-- When a venue page has owner_id=null (auto-imported or just unclaimed),
-- visitors who own that venue can click "Take ownership of this page".
-- That creates a pending claim. Admin reviews + approves, which
-- sets venues.owner_id = claimant.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists venue_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade not null,
  claimant_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  role text,                       -- e.g. "Owner", "Manager", "Booker"
  contact_phone text,
  contact_email text,
  reason text,                     -- "I've owned this pub since 2018" etc.
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text
);

create index if not exists venue_claims_venue_idx on venue_claims (venue_id);
create index if not exists venue_claims_user_idx on venue_claims (claimant_user_id);
create index if not exists venue_claims_pending_idx on venue_claims (status) where status = 'pending';

-- Stop one user spamming the same venue with multiple pending claims.
create unique index if not exists venue_claims_one_pending_per_user_per_venue
  on venue_claims (venue_id, claimant_user_id)
  where status = 'pending';

-- RLS
alter table venue_claims enable row level security;

-- Claimant: insert their own claim
drop policy if exists "venue_claims: claimant insert" on venue_claims;
create policy "venue_claims: claimant insert"
  on venue_claims for insert
  to authenticated
  with check (claimant_user_id = auth.uid());

-- Claimant: read their own claims
drop policy if exists "venue_claims: claimant select" on venue_claims;
create policy "venue_claims: claimant select"
  on venue_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

-- Claimant: withdraw their own pending claim
drop policy if exists "venue_claims: claimant withdraw" on venue_claims;
create policy "venue_claims: claimant withdraw"
  on venue_claims for update
  to authenticated
  using (claimant_user_id = auth.uid() and status = 'pending')
  with check (claimant_user_id = auth.uid() and status in ('pending', 'withdrawn'));

-- Admin: full access
drop policy if exists "venue_claims: admin all" on venue_claims;
create policy "venue_claims: admin all"
  on venue_claims for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================
