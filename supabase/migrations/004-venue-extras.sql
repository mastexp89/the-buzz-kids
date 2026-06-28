-- =====================================================================
-- Migration 004: Venue extras
-- - gallery_image_urls : photos of inside the venue (array)
-- - opening_hours      : free-text "Mon-Thu 12-11pm, Fri-Sat 12-1am"
-- - social media links : instagram, facebook, twitter, tiktok, spotify, youtube
-- =====================================================================

alter table public.venues
  add column if not exists gallery_image_urls text[] not null default '{}',
  add column if not exists opening_hours text,
  add column if not exists instagram text,
  add column if not exists facebook text,
  add column if not exists twitter text,
  add column if not exists tiktok text,
  add column if not exists spotify text,
  add column if not exists youtube text;
