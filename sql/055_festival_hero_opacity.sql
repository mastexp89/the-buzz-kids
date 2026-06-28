-- ============================================================
-- 055: Festival hero image opacity + blur
--
-- Lets the admin control how transparent AND how blurred the hero
-- backdrop is, per festival. Both were previously hard-coded
-- (opacity 0.5, blur 24px) — fine for most images but some festivals'
-- branded posters look washed out / unreadable at those defaults,
-- and some look better with no blur at all (so the cover photo
-- actually shows on the hero).
--
-- Opacity: 0.00–1.00 numeric, matches CSS opacity.
-- Blur:    0–40px smallint, matches CSS filter:blur(Npx).
--
-- Defaults match the previous hard-coded values so existing festivals
-- look identical to before this migration until the admin tweaks.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS hero_image_opacity numeric(3,2) NOT NULL DEFAULT 0.50
    CHECK (hero_image_opacity >= 0 AND hero_image_opacity <= 1);

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS hero_image_blur smallint NOT NULL DEFAULT 24
    CHECK (hero_image_blur >= 0 AND hero_image_blur <= 40);

COMMENT ON COLUMN public.festivals.hero_image_opacity IS
  'CSS opacity (0.00–1.00) applied to the hero backdrop image. Default 0.50 matches the previous hard-coded value. Lower = more muted (title reads cleaner over busy posters), higher = more visible.';

COMMENT ON COLUMN public.festivals.hero_image_blur IS
  'CSS blur in pixels (0–40) applied to the hero backdrop image. Default 24 matches the previous hard-coded value. Set to 0 for a sharp cover photo, raise it for a more muted textured backdrop.';
