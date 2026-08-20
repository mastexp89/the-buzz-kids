-- ============================================================
-- Facebook Page IDs for venues, so the daily roundup post can @-tag them.
--
-- Tagging works by putting @[<numeric page id>] in the post message. A tagged
-- Page gets a notification and is far more likely to reshare — which is the
-- whole point. We can't look IDs up automatically (Meta gates that behind
-- "Page Public Content Access" app review), so IDs come either from a stored
-- URL that already contains one, or from an admin pasting it.
--
-- NOTE for The Buzz Kids: unlike the Guide, almost no Kids venue has a usable
-- Facebook URL yet (the handful stored are /share/ links with no numeric id),
-- so this backfill will match ~nothing today. The column + admin screen exist
-- so tagging switches on the moment IDs are added — posts go out untagged
-- until then, and the cron retries without mentions if any tag is rejected.
--
-- Run this whole file in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists facebook_page_id text;

-- Backfill from the three Facebook URL shapes that embed a numeric id:
--   facebook.com/profile.php?id=<id>
--   facebook.com/pages/<Name>/<id>
--   facebook.com/people/<Name>/<id>
update public.venues
   set facebook_page_id = substring(facebook from 'profile\.php\?id=([0-9]{5,})')
 where facebook_page_id is null
   and facebook ~ 'profile\.php\?id=[0-9]{5,}';

update public.venues
   set facebook_page_id = substring(facebook from '/pages/[^/]+/([0-9]{5,})')
 where facebook_page_id is null
   and facebook ~ '/pages/[^/]+/[0-9]{5,}';

update public.venues
   set facebook_page_id = substring(facebook from '/people/[^/]+/([0-9]{5,})')
 where facebook_page_id is null
   and facebook ~ '/people/[^/]+/[0-9]{5,}';

create index if not exists venues_facebook_page_id_idx
  on public.venues (facebook_page_id)
  where facebook_page_id is not null;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Paste further IDs in Admin → Facebook Page IDs.
-- ============================================================
