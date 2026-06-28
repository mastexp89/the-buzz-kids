-- ============================================================
-- 032: Consolidate "Tribute Acts" into "Tribute / Covers".
--
-- We had two near-identical genres:
--   - tribute  → "Tribute Acts"
--   - covers   → "Tribute / Covers"
--
-- The covers slug already means tribute acts AND cover bands, so the
-- tribute slug is redundant. This migration:
--   1. Re-tags every event currently on "tribute" to also be on "covers"
--      (skipping any that are already on both, so no PK conflicts).
--   2. Drops the now-orphan event_genres rows pointing at "tribute".
--   3. Deletes the "tribute" genre row itself.
--
-- Idempotent — safe to re-run, no-op if "tribute" doesn't exist.
-- ============================================================

do $$
declare
  tribute_id uuid;
  covers_id uuid;
  migrated int := 0;
begin
  select id into tribute_id from public.genres where slug = 'tribute';
  select id into covers_id  from public.genres where slug = 'covers';

  if tribute_id is null then
    raise notice 'tribute slug already missing — nothing to consolidate';
    return;
  end if;
  if covers_id is null then
    raise exception 'covers slug missing — cannot consolidate without a target';
  end if;

  -- 1. Re-tag events: every event on tribute also gets covers.
  insert into public.event_genres (event_id, genre_id)
  select eg.event_id, covers_id
  from public.event_genres eg
  where eg.genre_id = tribute_id
  on conflict (event_id, genre_id) do nothing;

  get diagnostics migrated = row_count;
  raise notice 're-tagged % event(s) from tribute to covers', migrated;

  -- 2. Drop all event_genres rows pointing at tribute.
  delete from public.event_genres where genre_id = tribute_id;

  -- 3. Delete the tribute genre row itself.
  delete from public.genres where id = tribute_id;

  raise notice 'tribute genre row deleted';
end $$;

notify pgrst, 'reload schema';
