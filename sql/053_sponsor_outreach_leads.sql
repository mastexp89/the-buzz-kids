-- ============================================================
-- 053: Sponsor outreach leads
--
-- Backs the /admin/sponsor-outreach tool. Dylan searches Brave for
-- local independents (hairdressers, barbers, beauty/nail salons,
-- tattoo studios etc.) by city, and the tool saves the resulting
-- Facebook page rows here so he can:
--   • DM each page about sponsorship via Messenger
--   • tick "Contacted" so a re-run doesn't re-surface what he's done
--   • jot a note ("said maybe in May", "uninterested", "follow up")
--
-- fb_url is the natural key — a re-run for "barber Dundee" that finds
-- the same FB page Brave returned last week just updates the row
-- (touch updated_at) instead of inserting a dup.
--
-- RLS: locked down to admins. The actions go through the service
-- client so the policy is belt-and-braces, but it's there in case
-- someone ever exposes the table via PostgREST.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsor_outreach_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  fb_url text NOT NULL UNIQUE,
  -- "hairdresser", "barber", "hair salon", "beauty salon", "nail salon",
  -- "tattoo studio" — free-text so we can add new presets without a
  -- migration. Nullable for manually-added rows that don't fit a preset.
  business_type text,
  city_slug text REFERENCES public.cities(slug) ON DELETE SET NULL,
  -- Brave's snippet for the result — handy preview without re-fetching FB.
  description text,
  -- Admin's own notes (call outcome, next-step reminder, etc.)
  notes text,
  -- NULL = not yet contacted, set = the moment Dylan ticked the box.
  contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sponsor_outreach_leads_city_idx
  ON public.sponsor_outreach_leads(city_slug);
CREATE INDEX IF NOT EXISTS sponsor_outreach_leads_contacted_idx
  ON public.sponsor_outreach_leads(contacted_at);
CREATE INDEX IF NOT EXISTS sponsor_outreach_leads_btype_idx
  ON public.sponsor_outreach_leads(business_type);

-- Keep updated_at honest without trusting callers to set it.
CREATE OR REPLACE FUNCTION public.touch_sponsor_outreach_leads_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sponsor_outreach_leads_touch_updated_at
  ON public.sponsor_outreach_leads;
CREATE TRIGGER sponsor_outreach_leads_touch_updated_at
  BEFORE UPDATE ON public.sponsor_outreach_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_sponsor_outreach_leads_updated_at();

ALTER TABLE public.sponsor_outreach_leads ENABLE ROW LEVEL SECURITY;

-- Admins only. All writes go via server actions w/ service client which
-- bypasses RLS, but the SELECT policy means even if PostgREST ever
-- exposes the table, only admins can read it.
DROP POLICY IF EXISTS "sponsor_outreach_leads_admin_read" ON public.sponsor_outreach_leads;
CREATE POLICY "sponsor_outreach_leads_admin_read"
  ON public.sponsor_outreach_leads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

COMMENT ON TABLE public.sponsor_outreach_leads IS
  'Local businesses (mostly independents like hairdressers) discovered via Brave search for sponsorship outreach. Each row = a Facebook page Dylan can DM about sponsoring The Buzz Guide.';
