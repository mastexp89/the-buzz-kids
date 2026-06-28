-- The Buzz Guide: fix foreign keys that were created without an ON DELETE action,
-- which caused `auth.admin.deleteUser` to fail with
--   "Database error deleting user"
-- whenever the target user was referenced as a reviewer / uploader.
--
-- We switch each blocker to ON DELETE SET NULL so the audit trail is
-- preserved (the claim or extraction row stays) but the user reference
-- is cleared, allowing auth.users deletion to succeed.
--
-- Idempotent: drops the existing FK by name (if present) and re-adds it
-- with the correct action. Safe to re-run.

-- 1. venue_claims.reviewed_by ----------------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'venue_claims'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'reviewed_by';
  if fk_name is not null then
    execute format('alter table public.venue_claims drop constraint %I', fk_name);
  end if;
end $$;

alter table public.venue_claims
  add constraint venue_claims_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

-- 2. artist_claims.reviewed_by ---------------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'artist_claims'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'reviewed_by';
  if fk_name is not null then
    execute format('alter table public.artist_claims drop constraint %I', fk_name);
  end if;
end $$;

alter table public.artist_claims
  add constraint artist_claims_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

-- 3. extraction_batches.uploaded_by ----------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'extraction_batches'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'uploaded_by';
  if fk_name is not null then
    execute format('alter table public.extraction_batches drop constraint %I', fk_name);
  end if;
end $$;

alter table public.extraction_batches
  add constraint extraction_batches_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id) on delete set null;

notify pgrst, 'reload schema';
