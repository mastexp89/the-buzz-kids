-- ============================================================
-- The Buzz Guide: let admins write to venues regardless of owner_id.
-- Existing policies likely restrict insert/update/delete to the venue's
-- own owner. This adds parallel "admin can do anything" policies.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table venues enable row level security;

-- Admin: insert any venue (used by /admin/users/[id]/new-venue)
drop policy if exists "venues: admin insert" on venues;
create policy "venues: admin insert"
  on venues for insert
  to authenticated
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Admin: update any venue (used by Edit button on /admin)
drop policy if exists "venues: admin update" on venues;
create policy "venues: admin update"
  on venues for update
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Admin: delete any venue (used by Delete button on /admin)
drop policy if exists "venues: admin delete" on venues;
create policy "venues: admin delete"
  on venues for delete
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Same idea for events — admins should be able to mass-clean rejected/spam gigs
drop policy if exists "events: admin update" on events;
create policy "events: admin update"
  on events for update
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "events: admin delete" on events;
create policy "events: admin delete"
  on events for delete
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- DONE. Admins can now insert/update/delete any venue or event.
-- Venue owners' existing self-serve policies still work for their own rows.
-- ============================================================
