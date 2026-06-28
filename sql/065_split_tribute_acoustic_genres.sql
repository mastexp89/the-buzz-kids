-- ============================================================
-- 065: Split combined "Tribute / Covers" and "Acoustic /
--      Singer-Songwriter" genres into their narrower parts.
--
-- Background:
--   sql/032 consolidated "Tribute Acts" into "Tribute / Covers"
--   (slug = covers). That was a mistake — a tribute act ("ABBA
--   Mania") is quite different from a covers band ("Beatles Covers
--   Trio"), and admin / venue filters benefit from telling them
--   apart. Same story for "Acoustic / Singer-Songwriter": an
--   acoustic rock cover trio isn't the same kind of booking as a
--   solo writer of original songs.
--
-- What this migration does:
--   1. Renames "Tribute / Covers" (slug = covers) to just "Cover
--      bands" (slug stays `covers`). Adds a new sibling "Tribute
--      acts" (slug = tribute).
--   2. Renames "Acoustic / Singer-Songwriter" (slug = acoustic) to
--      just "Acoustic" (slug stays `acoustic`). Adds a new sibling
--      "Singer-songwriter" (slug = singer-songwriter).
--
-- Existing event_genres tags are NOT migrated. Events tagged with
-- the old combined name carry over to the renamed-narrower one
-- (covers stays covers, acoustic stays acoustic). When the admin
-- spots an event that should be on the new sibling instead, they
-- re-tag it from the admin Events tool.
--
-- Idempotent — safe to re-run. The pickEventIcon() helper already
-- supports all four slugs separately, so no app code change is
-- required to ship this.
-- ============================================================

-- 1. Rename "Tribute / Covers" → "Cover bands"
update public.genres
   set name = 'Cover bands'
 where slug = 'covers'
   and name <> 'Cover bands';

-- 2. Add new "Tribute acts" (slug = tribute) if not already present.
--    Some legacy deploys may still have a `tribute` row from pre-sql/032;
--    the ON CONFLICT clause handles that safely.
insert into public.genres (name, slug)
values ('Tribute acts', 'tribute')
on conflict (slug) do update set name = excluded.name;

-- 3. Rename "Acoustic / Singer-Songwriter" → "Acoustic"
update public.genres
   set name = 'Acoustic'
 where slug = 'acoustic'
   and name <> 'Acoustic';

-- 4. Add new "Singer-songwriter" (slug = singer-songwriter)
insert into public.genres (name, slug)
values ('Singer-songwriter', 'singer-songwriter')
on conflict (slug) do update set name = excluded.name;

-- Bust PostgREST's schema cache so the new rows are picked up
-- immediately without a deploy.
notify pgrst, 'reload schema';
