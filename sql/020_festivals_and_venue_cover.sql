-- ----------------------------------------------------------------------------
-- 020: Festivals + venue cover photos
-- ----------------------------------------------------------------------------
-- Two related additions:
--   1. Festivals — multi-venue branded events (e.g. Dundee Music Festival)
--   2. venues.cover_photo_url — auto-populated by FB / website scrapers when
--      a venue exterior or hero image is found, so the venue card / page has
--      something visual even when no logo has been manually set.

-- ---- Festivals --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS festivals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  slug            text        NOT NULL UNIQUE,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  hero_image_url  text,
  primary_color   text        DEFAULT '#e91e63',
  sponsor_text    text,
  ticket_url      text,
  description     text,
  -- Tagline shown on the landing hero, e.g. "2 days. 100+ acts. 45+ venues."
  tagline         text,
  published       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS festivals_slug_idx ON festivals(slug);
CREATE INDEX IF NOT EXISTS festivals_dates_idx ON festivals(start_date, end_date) WHERE published;

-- Join: which venues are part of this festival
CREATE TABLE IF NOT EXISTS festival_venues (
  festival_id uuid NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id)    ON DELETE CASCADE,
  sort_order  int  NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (festival_id, venue_id)
);

CREATE INDEX IF NOT EXISTS festival_venues_venue_idx ON festival_venues(venue_id);

-- ---- RLS --------------------------------------------------------------------
ALTER TABLE festivals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_venues ENABLE ROW LEVEL SECURITY;

-- Public can read published festivals + their venue list
DROP POLICY IF EXISTS "festivals_public_read" ON festivals;
CREATE POLICY "festivals_public_read" ON festivals
  FOR SELECT
  USING (published);

DROP POLICY IF EXISTS "festival_venues_public_read" ON festival_venues;
CREATE POLICY "festival_venues_public_read" ON festival_venues
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM festivals f
      WHERE f.id = festival_venues.festival_id AND f.published
    )
  );

-- Admins: full access
DROP POLICY IF EXISTS "festivals_admin_all" ON festivals;
CREATE POLICY "festivals_admin_all" ON festivals
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "festival_venues_admin_all" ON festival_venues;
CREATE POLICY "festival_venues_admin_all" ON festival_venues
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION festivals_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS festivals_updated_at_trg ON festivals;
CREATE TRIGGER festivals_updated_at_trg
BEFORE UPDATE ON festivals
FOR EACH ROW EXECUTE FUNCTION festivals_set_updated_at();

-- ---- Venue cover photo ------------------------------------------------------
-- A venue exterior / hero photo, auto-pulled by scrapers (FB profile picture,
-- website og:image of the homepage). Distinct from logo_url, which the venue
-- owner sets manually as their square brand mark.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS cover_photo_url text;

-- Track when we last attempted to populate it so the scraper doesn't keep
-- retrying for venues whose source page has no usable photo.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS cover_photo_last_attempt timestamptz;
