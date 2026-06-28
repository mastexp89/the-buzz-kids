-- ============================================================
-- 027: Allow venues.owner_id to be NULL so auto-imported venues
--      can sit unowned in the directory until a real owner
--      claims them.
--
-- Also: backfill any auto-imported venues currently owned by an
--       admin (i.e. the admin who triggered the bulk-add) so they
--       show as Unclaimed in the admin venue list — which is what
--       was intended.
--
-- The existing reassign / claim flows already handle null owner_id:
--   - The "Unclaimed" badge renders when !ownerEmail && isAutoImported
--   - reassignVenue(venueId, newOwnerId) sets owner_id to a real user
--   - The venue claim flow (sql/011) lets users submit a claim on
--     unclaimed venues
-- ============================================================

-- 1. Allow NULL on owner_id (idempotent — no-op if already nullable).
alter table public.venues
  alter column owner_id drop not null;

-- 2. Null out owner_id on auto-imported venues currently owned by an
--    admin user. Conservative: only touches rows where auto_imported is
--    true AND the owner is an admin profile (i.e. set as a side-effect
--    of bulk-add, not a real owner who happens to be admin too).
update public.venues v
set owner_id = null
where v.auto_imported = true
  and v.owner_id is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = v.owner_id
      and p.role = 'admin'
  );

notify pgrst, 'reload schema';
