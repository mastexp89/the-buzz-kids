-- ============================================================
-- 050: Sponsors "show on mobile app" toggle
--
-- Adds a flag so admins can choose whether each Buzz advertiser
-- appears in the mobile app's Locals tab as well as the web. Some
-- sponsors are bought specifically for web reach (typically Premium
-- with backlinks) and don't want their logo cluttering app users.
-- Defaults to true so existing sponsors don't suddenly disappear.
-- ============================================================

ALTER TABLE public.sponsors
  ADD COLUMN IF NOT EXISTS show_on_app boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS sponsors_show_on_app_idx
  ON public.sponsors(show_on_app)
  WHERE status = 'active' AND show_on_app = true;

COMMENT ON COLUMN public.sponsors.show_on_app IS
  'When false, sponsor is hidden from the mobile app''s Locals tab while still appearing on the web /sponsors directory + banners.';
