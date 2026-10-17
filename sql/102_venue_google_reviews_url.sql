-- A direct "read our Google reviews" link for a venue. Used when the live
-- Google rating isn't shown on the listing (e.g. service-area businesses the
-- Places API can't return a rating for) but families should still be able to
-- read the place's reviews. Rendered on the venue page under the rating area.
alter table venues
  add column if not exists google_reviews_url text;

-- Backfill: Rick Valentine Golf Schools (service-area profile; rating kept off
-- the listing, link families to the Reviews tab — opens via the 1b1 flag).
update venues
set google_reviews_url =
  'https://www.google.com/maps/place/Rick+Valentine+Golf+Schools/@51.5285262,-0.2664003,11z/data=!4m8!3m7!1s0x4887bbae39de143b:0xb59a4f451fd02687!8m2!3d51.5286416!4d-0.1015987!9m1!1b1!16s%2Fg%2F11gzqlm544'
where slug = 'rv-golf-schools-junior-golf-camps';
