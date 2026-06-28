-- ----------------------------------------------------------------------------
-- 023: Slug redirect table
-- ----------------------------------------------------------------------------
-- When an admin changes an artist's or venue's slug, the old URL would 404 —
-- breaking flyers, shared links, social posts that pointed at the old URL.
-- This table records every old → new slug change so the public page can
-- look it up and 301-redirect.
--
-- city_slug is null for artists (URL is /artists/<slug>, no city in path).
-- For venues it's the city slug at the time of the rename — venue URLs are
-- /<city>/venues/<slug>.

CREATE TABLE IF NOT EXISTS slug_redirects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('artist', 'venue')),
  city_slug     text,
  old_slug      text NOT NULL,
  new_slug      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, city_slug, old_slug)
);

CREATE INDEX IF NOT EXISTS slug_redirects_lookup_idx
  ON slug_redirects (resource_type, city_slug, old_slug);

-- Public read access — needed so the public pages (no auth) can resolve a
-- 404 slug to its current home.
ALTER TABLE slug_redirects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slug_redirects_public_read" ON slug_redirects;
CREATE POLICY "slug_redirects_public_read" ON slug_redirects
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "slug_redirects_admin_write" ON slug_redirects;
CREATE POLICY "slug_redirects_admin_write" ON slug_redirects
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
