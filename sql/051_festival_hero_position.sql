-- ============================================================
-- 051: Festival hero image position
--
-- Lets admin pick where the hero image's focal point sits in the
-- cropped hero band. The hero box is fixed-aspect (16:6) and uses
-- background-size: cover, so for tall/portrait images the default
-- "center" position can chop off important parts (faces, text, the
-- band logo). Admin can now nudge it to center / top / right etc.
--
-- Values are valid CSS background-position strings. Stored as text
-- with a default of 'center' so existing festivals don't change.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS hero_image_position text NOT NULL DEFAULT 'center';

COMMENT ON COLUMN public.festivals.hero_image_position IS
  'CSS background-position for the hero image — one of: center, top, bottom, left, right, top left, top right, bottom left, bottom right. Default center.';
