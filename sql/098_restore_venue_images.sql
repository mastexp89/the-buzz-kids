-- ============================================================
-- Fix site-wide broken images.
--
-- Google hardened hotlink protection on lh3.googleusercontent.com place-photos:
-- every stored google_photo_url / gallery_image_urls entry now returns 403 to
-- browsers AND to Vercel's image optimizer, so ~1,500 venues render a broken
-- image. Those URLs are unrecoverable (and Places photos were never licensed
-- for us to store permanently), so we:
--
--   1. clear the dead URLs, which makes cards fall back to the tidy 🐝
--      placeholder instead of a broken-image icon (instant visual fix), and
--   2. add image_restore_attempt so the "Restore images" admin tool can walk
--      through venues once each, re-hosting a picture from the venue's OWN
--      website into our media bucket (permanent, ours, can't be blocked).
--
-- cover_photo_url / image_url (manually uploaded) are NOT touched.
-- Run this whole file in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists image_restore_attempt timestamptz;

-- Clear the dead Google hotlinks (only the Google-CDN ones).
update public.venues
   set google_photo_url = null
 where google_photo_url like '%googleusercontent.com%';

-- NB: venues.gallery_image_urls is NOT NULL (defaults to '{}'), so empty the
-- array rather than nulling it.
update public.venues
   set gallery_image_urls = '{}'::text[]
 where gallery_image_urls is not null
   and array_to_string(gallery_image_urls, ',') like '%googleusercontent.com%';

-- Same problem in the new stays table (scraped from the same source).
update public.stays
   set photo_url = null
 where photo_url like '%googleusercontent.com%';

update public.stays
   set gallery_image_urls = '{}'::text[]
 where gallery_image_urls is not null
   and array_to_string(gallery_image_urls, ',') like '%googleusercontent.com%';

-- Let the restore tool retry venues whose photo we just cleared.
update public.venues
   set image_restore_attempt = null
 where cover_photo_url is null
   and website is not null;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Then run Admin → "Restore images" to re-host venue pictures.
-- ============================================================
