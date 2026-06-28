-- =====================================================================
-- Migration: add a separate logo column to venues.
--   image_url  → repurposed as the COVER photo (banner)
--   logo_url   → NEW, square logo for navbar/cards/avatars
-- Run this in Supabase SQL Editor.
-- =====================================================================

alter table public.venues
  add column if not exists logo_url text;
