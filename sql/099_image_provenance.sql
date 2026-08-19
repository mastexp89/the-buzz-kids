-- ============================================================
-- Image provenance + licensing.
--
-- Why: an image harvested from a venue's own website turned out to be licensed
-- stock (Alamy claimed it), and we had no record of where any image came from.
-- From now on every image stores its source, licence and required credit, so
-- (a) we can prove provenance, and (b) we can display the attribution that
-- CC BY / CC BY-SA licences legally require.
--
-- image_source: 'commons'  — Wikimedia Commons, openly licensed (preferred)
--               'website'  — harvested from the venue's own site (RISKY: may be
--                            licensed stock; being replaced by 'commons')
--               'upload'   — supplied by the venue/admin
-- Run this whole file in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.venues
  add column if not exists image_source       text,
  add column if not exists image_license      text,
  add column if not exists image_attribution  text,
  add column if not exists image_source_url   text,
  add column if not exists image_legal_attempt timestamptz;

-- Everything currently restored came from a venue website (the risky route).
update public.venues
   set image_source = 'website'
 where cover_photo_url is not null
   and image_source is null
   and cover_photo_url like '%/storage/v1/object/public/media/venues/%';

create index if not exists venues_image_source_idx on public.venues (image_source);

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Then run Admin → Restore images → "Swap to licensed photos".
-- ============================================================
