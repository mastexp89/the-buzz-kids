
-- ===================== sql/009_payments_table.sql =====================
-- 009_payments_table.sql
-- The payments ledger (Stripe subscription + promotion charges).
--
-- The original Buzz Guide database created this table out-of-band — its
-- CREATE TABLE was never committed as a migration, so a fresh install fails
-- at 010_payments_idempotency (which adds unique indexes ON payments).
-- Reconstructed here from the Stripe webhook handler
-- (src/app/api/stripe/webhook/route.ts) so the schema stands up cleanly.
--
-- NOTE: Stripe/payments is music-monetisation carried over from The Buzz
-- Guide and is slated for removal in the Buzz Kids strip (Stage 4). Kept for
-- now so the existing payment/promotion code runs against the new project.

create table if not exists public.payments (
  id                          uuid primary key default uuid_generate_v4(),
  venue_id                    uuid references public.venues(id)   on delete set null,
  owner_id                    uuid references public.profiles(id) on delete set null,
  event_id                    uuid references public.events(id)   on delete set null,
  type                        text not null,            -- 'subscription' | 'promotion'
  promotion_kind              text,                     -- spotlight | featured_pin | ...
  amount_cents                integer not null default 0,
  currency                    text not null default 'gbp',
  description                 text,
  stripe_checkout_session_id  text,
  stripe_invoice_id           text,
  stripe_payment_intent_id    text,
  created_at                  timestamptz not null default now()
);

create index if not exists payments_venue_idx on public.payments (venue_id);
create index if not exists payments_owner_idx on public.payments (owner_id);

-- RLS: only admins can read the ledger. Writes happen via the service-role
-- client in the Stripe webhook, which bypasses RLS.
alter table public.payments enable row level security;

drop policy if exists payments_admin_read on public.payments;
create policy payments_admin_read on public.payments for select
  using (public.is_admin());


-- ===================== sql/010_payments_idempotency.sql =====================
-- 010_payments_idempotency.sql
-- Defends against duplicate Stripe webhook deliveries inserting duplicate
-- payments rows for the same checkout session or invoice.
--
-- The webhook handler does an app-level "is there already a row for this
-- session?" check, but that check is a TOCTOU race if two webhook deliveries
-- arrive concurrently. These unique partial indexes are the database-level
-- belt-and-braces — they make the second insert fail loudly instead of
-- silently creating a duplicate.
--
-- Partial indexes (WHERE … IS NOT NULL) so existing rows that pre-date the
-- Stripe ID columns (or that have null IDs for any other reason) don't break
-- the constraint.

-- ---------------------------------------------------------------------------
-- 1. Clean up any existing duplicates BEFORE adding the unique indexes
--    (otherwise CREATE UNIQUE INDEX will fail).
--
-- For each duplicated stripe_checkout_session_id, keep the EARLIEST row
-- (smallest created_at) and delete the rest. Same for stripe_invoice_id.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stripe_checkout_session_id
      ORDER BY created_at ASC
    ) AS rn
  FROM payments
  WHERE stripe_checkout_session_id IS NOT NULL
)
DELETE FROM payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stripe_invoice_id
      ORDER BY created_at ASC
    ) AS rn
  FROM payments
  WHERE stripe_invoice_id IS NOT NULL
)
DELETE FROM payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---------------------------------------------------------------------------
-- 2. Unique partial indexes to prevent future duplicates at the DB level.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_session_id_uniq
  ON payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_id_uniq
  ON payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;


-- ===================== sql/011_venue_claims.sql =====================
-- ============================================================
-- The Buzz Guide: Venue claim flow.
-- When a venue page has owner_id=null (auto-imported or just unclaimed),
-- visitors who own that venue can click "Take ownership of this page".
-- That creates a pending claim. Admin reviews + approves, which
-- sets venues.owner_id = claimant.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists venue_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade not null,
  claimant_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  role text,                       -- e.g. "Owner", "Manager", "Booker"
  contact_phone text,
  contact_email text,
  reason text,                     -- "I've owned this pub since 2018" etc.
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text
);

create index if not exists venue_claims_venue_idx on venue_claims (venue_id);
create index if not exists venue_claims_user_idx on venue_claims (claimant_user_id);
create index if not exists venue_claims_pending_idx on venue_claims (status) where status = 'pending';

-- Stop one user spamming the same venue with multiple pending claims.
create unique index if not exists venue_claims_one_pending_per_user_per_venue
  on venue_claims (venue_id, claimant_user_id)
  where status = 'pending';

-- RLS
alter table venue_claims enable row level security;

-- Claimant: insert their own claim
drop policy if exists "venue_claims: claimant insert" on venue_claims;
create policy "venue_claims: claimant insert"
  on venue_claims for insert
  to authenticated
  with check (claimant_user_id = auth.uid());

-- Claimant: read their own claims
drop policy if exists "venue_claims: claimant select" on venue_claims;
create policy "venue_claims: claimant select"
  on venue_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

-- Claimant: withdraw their own pending claim
drop policy if exists "venue_claims: claimant withdraw" on venue_claims;
create policy "venue_claims: claimant withdraw"
  on venue_claims for update
  to authenticated
  using (claimant_user_id = auth.uid() and status = 'pending')
  with check (claimant_user_id = auth.uid() and status in ('pending', 'withdrawn'));

-- Admin: full access
drop policy if exists "venue_claims: admin all" on venue_claims;
create policy "venue_claims: admin all"
  on venue_claims for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================


-- ===================== sql/012_event_extraction.sql =====================
-- ============================================================
-- The Buzz Guide: AI event extraction pipeline.
-- Adds source-tracking columns to events so we know where each
-- auto-extracted gig came from (FB post, venue website, manual upload),
-- the model's confidence, and the original post/page so we can re-run
-- extraction with an improved prompt.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table events
  add column if not exists auto_imported_from text
    check (auto_imported_from in ('manual_upload', 'facebook', 'instagram', 'website', 'email')),
  add column if not exists auto_import_confidence numeric(3, 2),
  add column if not exists auto_import_source_url text,
  add column if not exists auto_import_evidence text,
  add column if not exists auto_import_image_url text,
  add column if not exists auto_import_post_text text,
  add column if not exists auto_import_batch_id uuid;

create index if not exists events_auto_imported_idx
  on events (auto_imported_from)
  where auto_imported_from is not null;

-- Batch table: keep raw payloads so we can re-extract later if the prompt improves
create table if not exists extraction_batches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade not null,
  source text not null
    check (source in ('manual_upload', 'facebook', 'instagram', 'website', 'email')),
  source_url text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz default now(),
  text_content text,
  image_urls text[],
  raw_response jsonb,
  events_created integer default 0,
  status text default 'processed'
    check (status in ('pending', 'processed', 'failed')),
  error_message text
);

create index if not exists extraction_batches_venue_idx on extraction_batches (venue_id, uploaded_at desc);

alter table extraction_batches enable row level security;

drop policy if exists "extraction_batches: admin all" on extraction_batches;
create policy "extraction_batches: admin all"
  on extraction_batches for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================


-- ===================== sql/013_artist_claims.sql =====================
-- ============================================================
-- The Buzz Guide: Artist claim flow.
-- Mirrors venue_claims. When an artist page has claimed_by=null
-- (auto-created from gigs / events / scraped posters), the artist or
-- their manager can click "Take ownership" to submit a claim.
-- Admin reviews + approves, which sets artists.claimed_by.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists artist_claims (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references artists(id) on delete cascade not null,
  claimant_user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  role text,                       -- "Artist", "Band member", "Manager", "Booker"
  contact_phone text,
  contact_email text,
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text
);

create index if not exists artist_claims_artist_idx on artist_claims (artist_id);
create index if not exists artist_claims_user_idx on artist_claims (claimant_user_id);
create index if not exists artist_claims_pending_idx on artist_claims (status) where status = 'pending';

create unique index if not exists artist_claims_one_pending_per_user_per_artist
  on artist_claims (artist_id, claimant_user_id)
  where status = 'pending';

alter table artist_claims enable row level security;

drop policy if exists "artist_claims: claimant insert" on artist_claims;
create policy "artist_claims: claimant insert"
  on artist_claims for insert
  to authenticated
  with check (claimant_user_id = auth.uid());

drop policy if exists "artist_claims: claimant select" on artist_claims;
create policy "artist_claims: claimant select"
  on artist_claims for select
  to authenticated
  using (claimant_user_id = auth.uid());

drop policy if exists "artist_claims: claimant withdraw" on artist_claims;
create policy "artist_claims: claimant withdraw"
  on artist_claims for update
  to authenticated
  using (claimant_user_id = auth.uid() and status = 'pending')
  with check (claimant_user_id = auth.uid() and status in ('pending', 'withdrawn'));

drop policy if exists "artist_claims: admin all" on artist_claims;
create policy "artist_claims: admin all"
  on artist_claims for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Allow claimants to update their own artist after approval (so they can
-- edit their bio / socials / photo). The 003-artists.sql migration may
-- already cover this via "self_or_admin_update", so this policy is just a
-- safety net keyed on claimed_by.
drop policy if exists "artists: claimer update" on artists;
create policy "artists: claimer update"
  on artists for update
  to authenticated
  using (claimed_by = auth.uid())
  with check (claimed_by = auth.uid());

-- ============================================================
-- DONE.
-- ============================================================


-- ===================== sql/014_analytics.sql =====================
-- ============================================================
-- The Buzz Guide: Page-view analytics for venues, artists and events.
-- One row per page view (server-side tracked, bots filtered out).
-- Admin dashboard aggregates over windows. Owners see their own.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  venue_id  uuid references venues(id)  on delete cascade,
  artist_id uuid references artists(id) on delete cascade,
  event_id  uuid references events(id)  on delete cascade,
  viewed_at timestamptz not null default now(),
  -- Optional context (might add later: country, referer, mobile/desktop)
  source text
);

-- Lookups by entity + time
create index if not exists page_views_venue_idx
  on page_views (venue_id, viewed_at desc) where venue_id is not null;
create index if not exists page_views_artist_idx
  on page_views (artist_id, viewed_at desc) where artist_id is not null;
create index if not exists page_views_event_idx
  on page_views (event_id, viewed_at desc) where event_id is not null;
-- Time-only scans (admin "total views in last 7d")
create index if not exists page_views_at_idx on page_views (viewed_at desc);

alter table page_views enable row level security;

-- Anyone can insert (server tracks via service role anyway, but if any client
-- ever fires a tracking event we want the anon role to be able to log it).
drop policy if exists "page_views: insert" on page_views;
create policy "page_views: insert"
  on page_views for insert
  to anon, authenticated
  with check (true);

-- Read: admin only for the global view. Owners can read their own venue/artist
-- views via dashboard server actions running with service role.
drop policy if exists "page_views: admin read" on page_views;
create policy "page_views: admin read"
  on page_views for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================


-- ===================== sql/015_click_tracking.sql =====================
-- ============================================================
-- The Buzz Guide: extend page_views with click-through tracking.
-- Adds a `kind` column so the same table can store both passive views
-- and active clicks (phone, website, maps, FB, IG, etc.).
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table page_views
  add column if not exists kind text not null default 'view';

-- Common click kinds:
--   view, click_phone, click_website, click_maps, click_email,
--   click_facebook, click_instagram, click_twitter, click_tiktok,
--   click_youtube, click_spotify, click_bandcamp, click_share, click_ticket

create index if not exists page_views_kind_idx on page_views (kind, viewed_at desc);

-- ============================================================
-- DONE.
-- ============================================================


-- ===================== sql/016_create_artist_on_signup.sql =====================
-- ============================================================
-- The Buzz Guide: when someone signs up as account_type=artist, also
-- create a matching row in the artists directory keyed to them
-- (claimed_by=user_id, approved=true), so they appear on /artists
-- and can be linked to events via event_artists.
--
-- Also backfills existing artist accounts that signed up before
-- this trigger landed but never got an artists row.
--
-- Safe to re-run.
-- ============================================================

-- 1. Replace handle_new_user trigger function with one that also
--    inserts the matching artists row for artist accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  acct text := coalesce(meta->>'account_type', 'venue');
  resolved_role text;
  artist_name text;
  base_slug text;
  candidate_slug text;
  attempt int := 0;
begin
  resolved_role := case acct
    when 'artist'    then 'artist'
    when 'organiser' then 'event_organiser'
    when 'venue'     then 'venue_owner'
    else 'venue_owner'
  end;

  insert into public.profiles (id, email, display_name, role, created_at)
  values (
    new.id,
    new.email,
    coalesce(meta->>'display_name', null),
    resolved_role,
    now()
  )
  on conflict (id) do update
    set
      email = excluded.email,
      display_name = coalesce(excluded.display_name, profiles.display_name),
      role = case
        when profiles.role in ('venue_owner','user') then excluded.role
        else profiles.role
      end;

  -- For artist signups, also create their public artist page so they
  -- show up on the directory immediately. Skip if they already have
  -- one claimed (e.g. they signed up before the trigger landed and
  -- the backfill below already handled them).
  if acct = 'artist' then
    artist_name := nullif(trim(coalesce(meta->>'display_name', new.email)), '');
    if artist_name is not null and not exists (
      select 1 from public.artists where claimed_by = new.id
    ) then
      base_slug := regexp_replace(
        regexp_replace(
          lower(replace(artist_name, '&', 'and')),
          '[^a-z0-9\s-]', '', 'g'
        ),
        '\s+', '-', 'g'
      );
      base_slug := regexp_replace(base_slug, '-+', '-', 'g');
      base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
      base_slug := substring(base_slug for 100);
      if base_slug = '' then
        base_slug := 'artist';
      end if;

      candidate_slug := base_slug;
      while attempt < 8 loop
        begin
          insert into public.artists (name, slug, claimed_by, approved)
          values (artist_name, candidate_slug, new.id, true);
          exit;
        exception when unique_violation then
          attempt := attempt + 1;
          candidate_slug := base_slug || '-' || (attempt + 1)::text;
        end;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

-- 2. Backfill existing artist accounts that don't have an artists row yet.
do $$
declare
  rec record;
  base_slug text;
  candidate_slug text;
  attempt int;
begin
  for rec in
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.email) as artist_name
    from public.profiles p
    left join public.artists a on a.claimed_by = p.id
    where p.role = 'artist' and a.id is null
      and coalesce(nullif(trim(p.display_name), ''), p.email) is not null
  loop
    base_slug := regexp_replace(
      regexp_replace(
        lower(replace(rec.artist_name, '&', 'and')),
        '[^a-z0-9\s-]', '', 'g'
      ),
      '\s+', '-', 'g'
    );
    base_slug := regexp_replace(base_slug, '-+', '-', 'g');
    base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
    base_slug := substring(base_slug for 100);
    if base_slug = '' then base_slug := 'artist'; end if;

    candidate_slug := base_slug;
    attempt := 0;
    while attempt < 8 loop
      begin
        insert into public.artists (name, slug, claimed_by, approved)
        values (rec.artist_name, candidate_slug, rec.id, true);
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        candidate_slug := base_slug || '-' || (attempt + 1)::text;
      end;
    end loop;
  end loop;
end $$;

-- ============================================================
-- DONE. New behaviour:
--   * Signing up as account_type=artist auto-creates an artists
--     row claimed by that user, appearing on /artists immediately.
--   * Existing artist accounts that were missing a directory page
--     have been backfilled (one row per profile).
-- ============================================================


-- ===================== sql/017_last_facebook_scrape.sql =====================
-- Track when each venue was last scraped via the FB cron job, so the
-- scheduled task can rotate through stalest venues first.
alter table public.venues
  add column if not exists last_facebook_scrape timestamptz;

create index if not exists venues_last_fb_scrape_idx
  on public.venues (last_facebook_scrape nulls first)
  where facebook is not null;


-- ===================== sql/018_artist_socials_and_storage.sql =====================
-- ============================================================
-- The Buzz Guide: add missing social columns to artists, plus a storage
-- RLS policy that lets signed-in artists upload their profile pic.
-- Safe to re-run.
-- ============================================================

-- 1. Social columns the artist edit form writes to
alter table public.artists
  add column if not exists instagram text,
  add column if not exists facebook  text,
  add column if not exists twitter   text,
  add column if not exists tiktok    text,
  add column if not exists spotify   text,
  add column if not exists bandcamp  text,
  add column if not exists youtube   text;

-- 2. Storage RLS — let any authenticated user upload to media/artists/<their uid>/
--    (Supabase storage policies live on storage.objects.)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users upload to artists folder'
  ) then
    create policy "Authenticated users upload to artists folder"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'artists'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- 3. Allow updating / deleting your own artist uploads (so re-upload replaces cleanly)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users update own artists folder'
  ) then
    create policy "Authenticated users update own artists folder"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'artists'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users delete own artists folder'
  ) then
    create policy "Authenticated users delete own artists folder"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'artists'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- 4. Public read on the media bucket (so the uploaded image is viewable on the artist page)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Public read media bucket'
  ) then
    create policy "Public read media bucket"
      on storage.objects
      for select
      to anon, authenticated
      using (bucket_id = 'media');
  end if;
end $$;

-- 5. Reload PostgREST schema cache so the new columns are visible immediately
notify pgrst, 'reload schema';


-- ===================== sql/019_messages.sql =====================
-- Messaging system: a single thread per non-admin user with The Buzz Guide admin team.
-- Each row is one message; user_id identifies the non-admin party in the thread.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  from_admin  boolean not null,
  body        text not null check (length(body) between 1 and 5000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

create index if not exists messages_unread_user_idx
  on public.messages (user_id) where read_at is null and from_admin = true;

create index if not exists messages_unread_admin_idx
  on public.messages (created_at desc) where read_at is null and from_admin = false;

alter table public.messages enable row level security;

-- The user can see their own thread
drop policy if exists "messages: user reads own thread" on public.messages;
create policy "messages: user reads own thread"
  on public.messages for select
  to authenticated
  using (user_id = auth.uid());

-- The user can post into their own thread, and only as a non-admin message
drop policy if exists "messages: user inserts own reply" on public.messages;
create policy "messages: user inserts own reply"
  on public.messages for insert
  to authenticated
  with check (user_id = auth.uid() and from_admin = false);

-- The user can mark admin-sent messages in their thread as read
drop policy if exists "messages: user marks read" on public.messages;
create policy "messages: user marks read"
  on public.messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins can do anything (mirrors how other admin policies work in this app)
drop policy if exists "messages: admin all" on public.messages;
create policy "messages: admin all"
  on public.messages for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

notify pgrst, 'reload schema';


-- ===================== sql/020_festivals_and_venue_cover.sql =====================
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


-- ===================== sql/021_festival_stat_overrides.sql =====================
-- ----------------------------------------------------------------------------
-- 021: Festival stat label overrides
-- ----------------------------------------------------------------------------
-- For early-announce / pre-lineup stage when the live event count would just
-- show "0 acts". Admin can set a literal label like "100+" or "Over 50" that
-- the landing page uses instead of the computed number.
-- Null → use the live count.

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS act_count_label   text;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS venue_count_label text;


-- ===================== sql/022_festival_preview_token.sql =====================
-- ----------------------------------------------------------------------------
-- 022: Festival preview tokens
-- ----------------------------------------------------------------------------
-- A per-festival opaque token that lets an unpublished festival be viewed
-- via /festivals/<slug>?preview=<token>. Used to send a sneak-peek URL to
-- prospective festival organisers (e.g. "here's what your page would look
-- like if you came on board") before they decide to go public.

ALTER TABLE festivals
  ADD COLUMN IF NOT EXISTS preview_token uuid NOT NULL DEFAULT gen_random_uuid();

-- Make sure existing rows get a token even though we set a default. Default
-- only applies on INSERT, so backfill anything that's NULL just in case.
UPDATE festivals SET preview_token = gen_random_uuid() WHERE preview_token IS NULL;

-- Allow public to read an unpublished festival when query matches the token.
-- We can't do this purely in RLS (the policy can't see query params), so the
-- check happens in the page handler instead. The existing "published" RLS
-- policy still applies for the published case. For the preview case, the
-- page handler will use the service-role client to fetch the festival.


-- ===================== sql/023_slug_redirects.sql =====================
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


-- ===================== sql/024_artist_signup_dedupe.sql =====================
-- ============================================================
-- 024: Don't auto-create an artist row on signup if a similar
--      *unclaimed* artist already exists.
--
-- Why: stops users creating duplicate pages for bands that already
--      have unclaimed entries in the directory. After signup we
--      route them through /dashboard/setup so they can either
--      claim the existing page or create a new one with a
--      double-check.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  acct text := COALESCE(meta->>'account_type', 'venue');
  resolved_role text;
  artist_name text;
  norm_name text;
  base_slug text;
  candidate_slug text;
  attempt int := 0;
  has_similar_unclaimed boolean;
BEGIN
  resolved_role := CASE acct
    WHEN 'artist'    THEN 'artist'
    WHEN 'organiser' THEN 'event_organiser'
    WHEN 'venue'     THEN 'venue_owner'
    ELSE 'venue_owner'
  END;

  INSERT INTO public.profiles (id, email, display_name, role, created_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(meta->>'display_name', NULL),
    resolved_role,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email = excluded.email,
      display_name = COALESCE(excluded.display_name, profiles.display_name),
      role = CASE
        WHEN profiles.role IN ('venue_owner','user') THEN excluded.role
        ELSE profiles.role
      END;

  -- For artist signups: skip auto-create if there's already an unclaimed
  -- artist with a matching normalised name. The /dashboard/setup page will
  -- then offer them to claim that one (or override and create new).
  IF acct = 'artist' THEN
    artist_name := NULLIF(TRIM(COALESCE(meta->>'display_name', new.email)), '');
    IF artist_name IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.artists WHERE claimed_by = new.id
    ) THEN
      norm_name := LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(artist_name, '^the\s+', '', 'i'),
        '[^a-z0-9]+', '', 'g'
      ));

      -- Is there an unclaimed artist with a similar normalised name?
      SELECT EXISTS (
        SELECT 1 FROM public.artists a
        WHERE a.claimed_by IS NULL
          AND LENGTH(norm_name) >= 3
          AND LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(a.name, '^the\s+', '', 'i'),
                '[^a-z0-9]+', '', 'g'
              )) = norm_name
      ) INTO has_similar_unclaimed;

      IF NOT has_similar_unclaimed THEN
        -- Safe to auto-create — no ambiguity
        base_slug := regexp_replace(
          regexp_replace(
            lower(replace(artist_name, '&', 'and')),
            '[^a-z0-9\s-]', '', 'g'
          ),
          '\s+', '-', 'g'
        );
        base_slug := regexp_replace(base_slug, '-+', '-', 'g');
        base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
        base_slug := substring(base_slug FOR 100);
        IF base_slug = '' THEN
          base_slug := 'artist';
        END IF;

        candidate_slug := base_slug;
        WHILE attempt < 8 LOOP
          BEGIN
            INSERT INTO public.artists (name, slug, claimed_by, approved)
            VALUES (artist_name, candidate_slug, new.id, true);
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            attempt := attempt + 1;
            candidate_slug := base_slug || '-' || (attempt + 1)::text;
          END;
        END LOOP;
      END IF;
      -- Else: leave them without an auto-created artist; they hit the
      -- /dashboard/setup wizard next where they can claim the existing one
      -- or override with create-new.
    END IF;
  END IF;

  RETURN new;
END;
$$;


-- ===================== sql/025_user_delete_fk_cleanup.sql =====================
-- The Buzz Guide: fix foreign keys that were created without an ON DELETE action,
-- which caused `auth.admin.deleteUser` to fail with
--   "Database error deleting user"
-- whenever the target user was referenced as a reviewer / uploader.
--
-- We switch each blocker to ON DELETE SET NULL so the audit trail is
-- preserved (the claim or extraction row stays) but the user reference
-- is cleared, allowing auth.users deletion to succeed.
--
-- Idempotent: drops the existing FK by name (if present) and re-adds it
-- with the correct action. Safe to re-run.

-- 1. venue_claims.reviewed_by ----------------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'venue_claims'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'reviewed_by';
  if fk_name is not null then
    execute format('alter table public.venue_claims drop constraint %I', fk_name);
  end if;
end $$;

alter table public.venue_claims
  add constraint venue_claims_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

-- 2. artist_claims.reviewed_by ---------------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'artist_claims'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'reviewed_by';
  if fk_name is not null then
    execute format('alter table public.artist_claims drop constraint %I', fk_name);
  end if;
end $$;

alter table public.artist_claims
  add constraint artist_claims_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;

-- 3. extraction_batches.uploaded_by ----------------------------------------
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'extraction_batches'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'uploaded_by';
  if fk_name is not null then
    execute format('alter table public.extraction_batches drop constraint %I', fk_name);
  end if;
end $$;

alter table public.extraction_batches
  add constraint extraction_batches_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id) on delete set null;

notify pgrst, 'reload schema';


-- ===================== sql/026_angus_city_and_nearby_areas.sql =====================
-- ============================================================
-- 026: Add a `nearby_areas` column to cities and seed the Angus
--      region.
--
-- Why: until now the site-importer's location filter was a hardcoded
--      constant ("Dundee" + ["Broughty Ferry"]). Moving it to the DB
--      lets each city carry its own list of towns/suburbs and lets us
--      add a second city (Angus) without touching code.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Schema: add nearby_areas to cities -----------------------------------
alter table public.cities
  add column if not exists nearby_areas text[] not null default '{}';

-- 2. Backfill existing Dundee row -----------------------------------------
update public.cities
   set nearby_areas = array['Broughty Ferry']
 where slug = 'dundee'
   and (nearby_areas is null or array_length(nearby_areas, 1) is null);

-- 3. Insert (or update) the Angus city row --------------------------------
insert into public.cities (name, slug, active, nearby_areas)
values (
  'Angus',
  'angus',
  true,
  array[
    -- Major towns
    'Arbroath',
    'Brechin',
    'Carnoustie',
    'Forfar',
    'Kirriemuir',
    'Monifieth',
    'Montrose',
    -- Smaller towns
    'Edzell',
    'Friockheim',
    'Letham',
    -- Notable villages (add more here if events show up from elsewhere
    -- and the AI rejects them as out-of-area)
    'Auchmithie',
    'Auchterhouse',
    'Birkhill',
    'Glamis',
    'Inverkeilor',
    'Newtyle',
    'Tannadice',
    'Tealing'
  ]
)
on conflict (slug) do update
  set name = excluded.name,
      active = excluded.active,
      nearby_areas = excluded.nearby_areas;

notify pgrst, 'reload schema';


-- ===================== sql/027_venues_owner_id_nullable.sql =====================
-- ============================================================
-- 027: Allow venues.owner_id to be NULL so auto-imported venues
--      can sit unowned in the directory until a real owner
--      claims them.
--
-- Also: backfill any auto-imported venues currently owned by an
--       admin (i.e. the admin who triggered the bulk-add) so they
--       show as Unclaimed in the admin venue list — which is what
--       was intended.
--
-- The existing reassign / claim flows already handle null owner_id:
--   - The "Unclaimed" badge renders when !ownerEmail && isAutoImported
--   - reassignVenue(venueId, newOwnerId) sets owner_id to a real user
--   - The venue claim flow (sql/011) lets users submit a claim on
--     unclaimed venues
-- ============================================================

-- 1. Allow NULL on owner_id (idempotent — no-op if already nullable).
alter table public.venues
  alter column owner_id drop not null;

-- 2. Null out owner_id on auto-imported venues currently owned by an
--    admin user. Conservative: only touches rows where auto_imported is
--    true AND the owner is an admin profile (i.e. set as a side-effect
--    of bulk-add, not a real owner who happens to be admin too).
update public.venues v
set owner_id = null
where v.auto_imported = true
  and v.owner_id is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = v.owner_id
      and p.role = 'admin'
  );

notify pgrst, 'reload schema';


-- ===================== sql/028_organisers.sql =====================
-- ============================================================
-- 028: Event organisers — separate entity from artists.
--
-- An organiser is a promoter / event company that runs gigs across
-- multiple venues. They have their own public profile page (bio,
-- socials, image, website) and can claim ownership of events they
-- promote. Same approval / review model as venues + artists.
--
-- Why a separate table from `artists`:
--   - Different mental model (organiser != performer)
--   - Different URL pattern (/organisers/[slug] vs /artists/[slug])
--   - Future fields might diverge (touring schedules, white-label
--     festival pages, etc.)
-- ============================================================

create table if not exists public.organisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (length(slug) between 1 and 120),
  bio text,
  image_url text,
  website text,
  instagram text,
  facebook text,
  twitter text,
  tiktok text,
  spotify text,
  bandcamp text,
  youtube text,
  email text,
  -- Owner: the user account that manages this profile. Nullable so the
  -- profile can exist before being claimed (admin-created etc).
  claimed_by uuid references auth.users(id) on delete set null,
  -- Same approval model as venues / artists: false = pending review,
  -- true = visible publicly + edits go straight to public page.
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organisers_claimed_by_idx
  on public.organisers (claimed_by) where claimed_by is not null;
create index if not exists organisers_slug_idx
  on public.organisers (slug);
create index if not exists organisers_approved_idx
  on public.organisers (approved) where approved = true;

-- updated_at auto-bump via trigger. Inline-define the helper function so
-- this migration has no external dependency.
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organisers_updated_at on public.organisers;
create trigger organisers_updated_at
  before update on public.organisers
  for each row execute function public.update_updated_at_column();

-- Junction table linking an organiser to an event they organise. Many
-- organisers can co-promote one event; one organiser can run many events.
create table if not exists public.event_organisers (
  event_id uuid not null references public.events(id) on delete cascade,
  organiser_id uuid not null references public.organisers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, organiser_id)
);

create index if not exists event_organisers_event_idx on public.event_organisers (event_id);
create index if not exists event_organisers_organiser_idx on public.event_organisers (organiser_id);

-- ============================================================
-- RLS — public read for approved organisers + their event links;
-- claimer / admin can manage their own row.
-- ============================================================

alter table public.organisers enable row level security;
alter table public.event_organisers enable row level security;

-- Public can read approved organisers
drop policy if exists "organisers: public read approved" on public.organisers;
create policy "organisers: public read approved"
  on public.organisers for select
  to anon, authenticated
  using (approved = true);

-- Claimer can read their own row even if not yet approved
drop policy if exists "organisers: owner reads own" on public.organisers;
create policy "organisers: owner reads own"
  on public.organisers for select
  to authenticated
  using (claimed_by = auth.uid());

-- Claimer can update their own row
drop policy if exists "organisers: owner updates own" on public.organisers;
create policy "organisers: owner updates own"
  on public.organisers for update
  to authenticated
  using (claimed_by = auth.uid())
  with check (claimed_by = auth.uid());

-- Admin can do anything
drop policy if exists "organisers: admin all" on public.organisers;
create policy "organisers: admin all"
  on public.organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- event_organisers: public read all (mirrors event_artists), owner of
-- the linked organiser can insert / delete.
drop policy if exists "event_organisers: public read" on public.event_organisers;
create policy "event_organisers: public read"
  on public.event_organisers for select
  to anon, authenticated
  using (true);

drop policy if exists "event_organisers: claimer manages" on public.event_organisers;
create policy "event_organisers: claimer manages"
  on public.event_organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.organisers o
      where o.id = event_organisers.organiser_id
        and o.claimed_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.organisers o
      where o.id = event_organisers.organiser_id
        and o.claimed_by = auth.uid()
    )
  );

drop policy if exists "event_organisers: admin all" on public.event_organisers;
create policy "event_organisers: admin all"
  on public.event_organisers for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

notify pgrst, 'reload schema';


-- ===================== sql/029_sponsors.sql =====================
-- ============================================================
-- 029: Sponsors — third-party local businesses paying for ad slots
-- on The Buzz Guide (takeaways, taxis, hairdressers, etc).
--
-- Distinct from `payments` / promotions, which are venue owners
-- paying Stripe to boost their own listing. Sponsors are external
-- businesses with no Buzz account — admin manages them by hand and
-- they pay by bank transfer or manual Stripe invoice.
--
-- Three tiers:
--   - starter  £30/mo: small box on venue/event detail pages
--   - popular  £60/mo: rotating homepage banner + category placement
--                       + manual social shoutout (off-platform)
--   - premium £100/mo: large homepage banner + app placement +
--                       sponsored weekend guide + profile page on
--                       /sponsors/[slug] + manual social posts
--
-- Status drives visibility together with the date range; a sponsor
-- is publicly visible only when status='active' AND now() is between
-- starts_at and ends_at.
-- ============================================================

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (length(slug) between 1 and 120),

  -- Pricing tier. Drives where + how prominently the ad renders.
  tier text not null check (tier in ('starter', 'popular', 'premium')),

  -- Which city the ad targets. Null = nationwide (shown everywhere).
  city_id uuid references public.cities(id) on delete set null,

  -- Loose taxonomy so we can show contextually-relevant ads later
  -- (e.g. takeaway tile near event listings on a Friday night).
  category text check (category in (
    'takeaway', 'restaurant', 'taxi', 'hairdresser', 'barber',
    'services', 'retail', 'leisure', 'other'
  )),

  -- The image users see in the ad. Logos look best contained, so
  -- we'll size + position them in CSS rather than baking it in.
  image_url text,

  -- Where the ad clicks through to. External URL, no domain restriction.
  link_url text not null,

  -- One-line slogan / tagline shown next to the logo on the banner.
  blurb text check (blurb is null or length(blurb) <= 200),

  -- Lifecycle. 'paused' lets us turn an ad off temporarily without
  -- destroying the row (renewal pending, customer complaint, etc).
  status text not null default 'active'
    check (status in ('active', 'paused', 'expired')),

  -- Date range during which the ad is live. UTC.
  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- For our records — what the customer paid this cycle (in GBP).
  monthly_price numeric(10, 2),

  -- Counters bumped by /api/track for impression + click reporting.
  -- Cheap to read on the admin page; we'll graph them later.
  impression_count integer not null default 0,
  click_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sponsors_dates_chk check (ends_at > starts_at)
);

create index if not exists sponsors_active_idx
  on public.sponsors (status, starts_at, ends_at) where status = 'active';
create index if not exists sponsors_city_tier_idx
  on public.sponsors (city_id, tier) where status = 'active';
create index if not exists sponsors_slug_idx on public.sponsors (slug);
create index if not exists sponsors_ends_at_idx
  on public.sponsors (ends_at) where status = 'active';

-- updated_at trigger reuses the helper created in 028.
drop trigger if exists sponsors_updated_at on public.sponsors;
create trigger sponsors_updated_at
  before update on public.sponsors
  for each row execute function public.update_updated_at_column();

-- ============================================================
-- RLS — public can read currently-live sponsors only; admin
-- manages everything else.
-- ============================================================

alter table public.sponsors enable row level security;

-- Public read: only currently-live sponsors.
drop policy if exists "sponsors: public read live" on public.sponsors;
create policy "sponsors: public read live"
  on public.sponsors for select
  to anon, authenticated
  using (
    status = 'active'
    and starts_at <= now()
    and ends_at >= now()
  );

-- Admin sees everything (paused, expired, future-dated).
drop policy if exists "sponsors: admin read all" on public.sponsors;
create policy "sponsors: admin read all"
  on public.sponsors for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "sponsors: admin write" on public.sponsors;
create policy "sponsors: admin write"
  on public.sponsors for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Service role (server-side admin actions, tracker endpoint that
-- bumps counters) bypasses RLS by default — no policy needed.

-- ============================================================
-- Atomic counter helpers. Called from the banner + click tracker
-- via service client so we can bump without read-then-write race.
-- ============================================================

create or replace function public.increment_sponsor_impression(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set impression_count = impression_count + 1
  where id = sponsor_id;
$$;

create or replace function public.increment_sponsor_click(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set click_count = click_count + 1
  where id = sponsor_id;
$$;

-- Lock down direct execution: only service_role calls these.
revoke all on function public.increment_sponsor_impression(uuid) from public, anon, authenticated;
revoke all on function public.increment_sponsor_click(uuid) from public, anon, authenticated;
grant execute on function public.increment_sponsor_impression(uuid) to service_role;
grant execute on function public.increment_sponsor_click(uuid) to service_role;

notify pgrst, 'reload schema';


-- ===================== sql/030_sponsors_storage_policy.sql =====================
-- ============================================================
-- 030: Storage RLS — let admins upload sponsor logos.
--
-- Sponsors are managed exclusively by admins (advertisers don't have
-- Buzz accounts), so the policy is gated on profiles.role = 'admin'
-- rather than on the user owning the row (as we do for artists/venues).
--
-- Path shape: media/sponsors/{adminUserId}/{timestamp}.{ext}
-- The {adminUserId} component is kept so we can see who uploaded what.
-- Safe to re-run.
-- ============================================================

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Admins upload to sponsors folder'
  ) then
    create policy "Admins upload to sponsors folder"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'sponsors'
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'admin'
        )
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Admins update sponsors folder'
  ) then
    create policy "Admins update sponsors folder"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'sponsors'
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'admin'
        )
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Admins delete sponsors folder'
  ) then
    create policy "Admins delete sponsors folder"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'sponsors'
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'admin'
        )
      );
  end if;
end $$;

-- Public read on the media bucket is already in place from sql/018.

notify pgrst, 'reload schema';


-- ===================== sql/031_sponsor_rpc_helpers.sql =====================
-- ============================================================
-- 031: Sponsor counter RPC helpers.
--
-- These were added late to sql/029 after the table itself shipped,
-- so this migration just ensures they exist on databases that ran
-- 029 before they were added.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create or replace function public.increment_sponsor_impression(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set impression_count = impression_count + 1
  where id = sponsor_id;
$$;

create or replace function public.increment_sponsor_click(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set click_count = click_count + 1
  where id = sponsor_id;
$$;

-- Service role only. Block public / authenticated execution so a regular
-- user can't manually inflate counters by calling the RPC themselves.
revoke all on function public.increment_sponsor_impression(uuid) from public, anon, authenticated;
revoke all on function public.increment_sponsor_click(uuid) from public, anon, authenticated;
grant execute on function public.increment_sponsor_impression(uuid) to service_role;
grant execute on function public.increment_sponsor_click(uuid) to service_role;

notify pgrst, 'reload schema';


-- ===================== sql/032_consolidate_tribute_genres.sql =====================
-- ============================================================
-- 032: Consolidate "Tribute Acts" into "Tribute / Covers".
--
-- We had two near-identical genres:
--   - tribute  → "Tribute Acts"
--   - covers   → "Tribute / Covers"
--
-- The covers slug already means tribute acts AND cover bands, so the
-- tribute slug is redundant. This migration:
--   1. Re-tags every event currently on "tribute" to also be on "covers"
--      (skipping any that are already on both, so no PK conflicts).
--   2. Drops the now-orphan event_genres rows pointing at "tribute".
--   3. Deletes the "tribute" genre row itself.
--
-- Idempotent — safe to re-run, no-op if "tribute" doesn't exist.
-- ============================================================

do $$
declare
  tribute_id uuid;
  covers_id uuid;
  migrated int := 0;
begin
  select id into tribute_id from public.genres where slug = 'tribute';
  select id into covers_id  from public.genres where slug = 'covers';

  if tribute_id is null then
    raise notice 'tribute slug already missing — nothing to consolidate';
    return;
  end if;
  if covers_id is null then
    raise exception 'covers slug missing — cannot consolidate without a target';
  end if;

  -- 1. Re-tag events: every event on tribute also gets covers.
  insert into public.event_genres (event_id, genre_id)
  select eg.event_id, covers_id
  from public.event_genres eg
  where eg.genre_id = tribute_id
  on conflict (event_id, genre_id) do nothing;

  get diagnostics migrated = row_count;
  raise notice 're-tagged % event(s) from tribute to covers', migrated;

  -- 2. Drop all event_genres rows pointing at tribute.
  delete from public.event_genres where genre_id = tribute_id;

  -- 3. Delete the tribute genre row itself.
  delete from public.genres where id = tribute_id;

  raise notice 'tribute genre row deleted';
end $$;

notify pgrst, 'reload schema';


-- ===================== sql/033_audit_log.sql =====================
-- Audit log for user-driven edits to venues / artists / organisers / events.
-- Lets /admin/activity-log show field-by-field "what changed" for every
-- edit, rather than just inferring from updated_at.
--
-- Design:
--   * Generic trigger function audit_changes(name_field) writes one row
--     per INSERT/UPDATE/DELETE that an authenticated user causes.
--   * Skip writes when auth.uid() IS NULL — this naturally excludes the
--     Facebook scraper, AI imports, dedupe cron, and admin queue actions
--     (which all use the service role). Browser edits via the dashboard
--     run as the authenticated user, so they're captured.
--   * For UPDATE, only the changed fields land in changed_fields, as
--     { field: { old, new } } pairs. updated_at is stripped because it
--     changes on every write and is just noise.
--   * row_name is captured at trigger time (entity.name for venues /
--     artists / organisers, entity.title for events) so DELETE rows still
--     display nicely after the entity is gone.
--
-- Pruning: rows older than 30 days get dropped by the daily dedupe cron
-- (see api/cron/dedupe-events/route.ts). Keeps the table small.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  row_name text,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_fields jsonb NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_table_row_idx
  ON public.audit_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON public.audit_log (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

-- RLS: admins read, no one writes via Supabase clients (only the trigger
-- function inserts, running as definer).
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log admin read" ON public.audit_log;
CREATE POLICY "audit_log admin read"
  ON public.audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------
-- TG_ARGV[0] = name of the column to capture as row_name. For venues /
-- artists / organisers that's 'name'; for events it's 'title'.

CREATE OR REPLACE FUNCTION public.audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  name_col text := COALESCE(TG_ARGV[0], 'name');
  diff jsonb := '{}'::jsonb;
  k text;
  old_v jsonb;
  new_v jsonb;
  new_json jsonb;
  old_json jsonb;
  display_name text;
BEGIN
  -- Skip non-authenticated writes: cron jobs, AI imports, admin queue
  -- actions and any other service-role traffic. We only want to log
  -- edits that a real user made through the app.
  IF actor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);
    display_name := new_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, NEW.id, display_name, 'insert', new_json, actor_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    new_json := to_jsonb(NEW);
    old_json := to_jsonb(OLD);
    FOR k IN SELECT jsonb_object_keys(new_json) LOOP
      old_v := old_json -> k;
      new_v := new_json -> k;
      IF old_v IS DISTINCT FROM new_v THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_v, 'new', new_v));
      END IF;
    END LOOP;
    -- Updated_at changes on every write — pure noise for the audit log.
    diff := diff - 'updated_at';
    IF diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    display_name := new_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, NEW.id, display_name, 'update', diff, actor_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    display_name := old_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, OLD.id, display_name, 'delete', old_json, actor_id);
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------
-- Attach triggers to the four user-editable tables
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS audit_venues ON public.venues;
CREATE TRIGGER audit_venues
  AFTER INSERT OR UPDATE OR DELETE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.audit_changes('name');

DROP TRIGGER IF EXISTS audit_artists ON public.artists;
CREATE TRIGGER audit_artists
  AFTER INSERT OR UPDATE OR DELETE ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.audit_changes('name');

DROP TRIGGER IF EXISTS audit_organisers ON public.organisers;
CREATE TRIGGER audit_organisers
  AFTER INSERT OR UPDATE OR DELETE ON public.organisers
  FOR EACH ROW EXECUTE FUNCTION public.audit_changes('name');

DROP TRIGGER IF EXISTS audit_events ON public.events;
CREATE TRIGGER audit_events
  AFTER INSERT OR UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.audit_changes('title');


-- ===================== sql/034_audit_log_filters.sql =====================
-- Fix audit_log filtering.
--
-- The original 033 trigger skipped any write where auth.uid() IS NULL,
-- intending to filter out cron / AI imports. But every dashboard server
-- action uses the service role (createServiceClient) for the actual
-- write to bypass RLS — and service-role writes also have NULL
-- auth.uid(). Result: nothing got logged from the dashboard.
--
-- Fix: log everything by default, and filter out the specific signatures
-- of cron-driven writes (which touch known fields only). actor_user_id
-- will still be NULL for dashboard service-role writes — that's "what /
-- when" without "who". Proper actor tracking is a follow-up.

CREATE OR REPLACE FUNCTION public.audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();  -- NULL for service-role writes (most edits)
  name_col text := COALESCE(TG_ARGV[0], 'name');
  diff jsonb := '{}'::jsonb;
  k text;
  old_v jsonb;
  new_v jsonb;
  new_json jsonb;
  old_json jsonb;
  display_name text;
  -- Field-name patterns the FB scraper / cover-photo backfill touch on
  -- every cron run. An UPDATE whose diff contains ONLY these fields is
  -- background work and shouldn't pollute the audit log.
  cron_only_fields text[] := ARRAY[
    'last_facebook_scrape',
    'cover_photo_url',
    'cover_photo_last_attempt',
    'cover_photo_etag'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);

    -- Auto-imported events from the FB scraper / AI pipeline.
    IF TG_TABLE_NAME = 'events'
       AND (new_json ->> 'auto_imported_from') IS NOT NULL THEN
      RETURN NEW;
    END IF;
    -- Auto-discovered venues (admin "Discover venues" tool inserts with
    -- owner_id NULL). Once someone claims it, the UPDATE will log.
    IF TG_TABLE_NAME = 'venues'
       AND (new_json ->> 'owner_id') IS NULL THEN
      RETURN NEW;
    END IF;
    -- Auto-created artist pages from the FB scraper (no claimer yet).
    IF TG_TABLE_NAME = 'artists'
       AND (new_json ->> 'claimed_by') IS NULL THEN
      RETURN NEW;
    END IF;
    -- Auto-created organiser pages (no claimer yet).
    IF TG_TABLE_NAME = 'organisers'
       AND (new_json ->> 'claimed_by') IS NULL THEN
      RETURN NEW;
    END IF;

    display_name := new_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, NEW.id, display_name, 'insert', new_json, actor_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    new_json := to_jsonb(NEW);
    old_json := to_jsonb(OLD);
    FOR k IN SELECT jsonb_object_keys(new_json) LOOP
      old_v := old_json -> k;
      new_v := new_json -> k;
      IF old_v IS DISTINCT FROM new_v THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_v, 'new', new_v));
      END IF;
    END LOOP;
    -- updated_at flips on every write; pure noise.
    diff := diff - 'updated_at';
    -- Strip cron-touched fields. If the diff is empty afterward, the
    -- change was purely cron-driven — skip the audit row entirely.
    diff := diff - cron_only_fields;
    IF diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    display_name := new_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, NEW.id, display_name, 'update', diff, actor_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    display_name := old_json ->> name_col;
    INSERT INTO public.audit_log (table_name, row_id, row_name, action, changed_fields, actor_user_id)
    VALUES (TG_TABLE_NAME, OLD.id, display_name, 'delete', old_json, actor_id);
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ===================== sql/035_venue_outreach.sql =====================
-- Track which unclaimed venues we've already DM'd on Facebook (or any
-- other manual outreach channel). Powers /admin/venue-outreach so we
-- don't double-message anyone.
--
-- Single timestamp column is enough for now — we don't need a separate
-- table of who-messaged-when until we have multiple people doing
-- outreach. Can backfill from this column into a richer schema later.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS outreach_messaged_at timestamptz;

-- Quick index for the "not yet messaged" filter used by the outreach page.
CREATE INDEX IF NOT EXISTS venues_outreach_not_messaged_idx
  ON public.venues (outreach_messaged_at)
  WHERE outreach_messaged_at IS NULL AND owner_id IS NULL AND facebook IS NOT NULL;


-- ===================== sql/036_festival_event_visibility.sql =====================
-- Festival drafts shouldn't leak.
--
-- Until now, festival events were just regular `events` rows linked
-- (via venue) to whatever venues admin had added to `festival_venues`.
-- There was no plumbing tying an event's public visibility to its
-- festival's `published` flag — so an admin uploading the lineup for
-- a draft festival immediately spilled every event onto the public
-- venue / artist / city pages.
--
-- This migration adds:
--   1. festivals.logo_url — square brand mark, separate from the wide
--      hero_image_url, so the festival admin tools and any future
--      compact festival display can show the right kind of image.
--   2. events.festival_id — nullable FK. When set, the event belongs
--      to that festival, and is only visible to the public when the
--      festival is published.
--   3. Updated public read policy on events that enforces the
--      festival-published rule. Service-role clients (admin tools,
--      cron) bypass RLS and still see everything; an admin SELECT
--      policy is added so admin server-side pages using the
--      authenticated client also see draft events.

-- ---- 1. Festival logo column -----------------------------------------------
ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS logo_url text;

-- ---- 2. Festival link on events --------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS festival_id uuid
  REFERENCES public.festivals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_festival_idx
  ON public.events(festival_id)
  WHERE festival_id IS NOT NULL;

-- ---- 3. Visibility: only published festivals expose their events ----------
-- Replace the existing public read policy. The new version preserves the
-- old approved-status check AND adds the festival visibility constraint.
DROP POLICY IF EXISTS "events: public read approved" ON public.events;
CREATE POLICY "events: public read approved"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (
    COALESCE(status, 'approved') = 'approved'
    AND (
      festival_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.festivals f
        WHERE f.id = events.festival_id AND f.published
      )
    )
  );

-- ---- 4. Admin SELECT bypass ------------------------------------------------
-- Without this, admins using the authenticated server client (most of the
-- admin pages) wouldn't see draft festival events on their own admin
-- screens. Service-role queries bypass RLS regardless; this policy is for
-- admin server components rendering with the user's auth cookies.
DROP POLICY IF EXISTS "events: admin read all" ON public.events;
CREATE POLICY "events: admin read all"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';


-- ===================== sql/037_festival_storage_policy.sql =====================
-- Storage RLS for the festivals/ folder in the `media` bucket.
--
-- Without these policies, the admin hero / logo / poster uploads on the
-- festival admin pages fail with "new row violates row-level security
-- policy" because the existing policies only cover artists/<uid>/ and
-- sponsors/. Admins-only — non-admin users have no business uploading
-- festival assets.
--
-- Safe to re-run.

-- INSERT
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Admins upload to festivals folder'
  ) THEN
    CREATE POLICY "Admins upload to festivals folder"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'media'
        AND (storage.foldername(name))[1] = 'festivals'
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- UPDATE (so re-uploads / replacements overwrite cleanly)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Admins update festivals folder'
  ) THEN
    CREATE POLICY "Admins update festivals folder"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'media'
        AND (storage.foldername(name))[1] = 'festivals'
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- DELETE (so the "Remove" button on the hero / logo editors works)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Admins delete festivals folder'
  ) THEN
    CREATE POLICY "Admins delete festivals folder"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'media'
        AND (storage.foldername(name))[1] = 'festivals'
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;


-- ===================== sql/038_festival_contact_email.sql =====================
-- Per-festival contact email for the "Want to play? / Want to be
-- involved?" CTAs on the festival landing page. Previously hardcoded
-- to grouchosmusicbar@gmail.com because that's who the first festival
-- was for — wrong on every other festival.

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS contact_email text;


-- ===================== sql/039_drop_legacy_events_public_read.sql =====================
-- Drop the legacy events_public_read policy.
--
-- This policy was created outside the migration files (probably via the
-- Supabase dashboard at some point) and grants public SELECT to every
-- event whose venue exists — no status check, no festival visibility
-- check. RLS policies on the same operation are OR'd, so this policy
-- was silently overriding the festival_id visibility filter that
-- sql/036 added: draft-festival events were appearing on the public
-- site even though the proper "events: public read approved" policy
-- would have hidden them.
--
-- The intended public read policy is "events: public read approved"
-- (with the spaces + colons in its name) — that one DOES include both
-- the status and festival visibility checks, so dropping the legacy
-- duplicate is safe.

DROP POLICY IF EXISTS "events_public_read" ON public.events;


-- ===================== sql/040_favourites.sql =====================
-- Phase 1: punter favourites + notification preferences.
--
-- One table covers favourites of every entity type. target_type tells
-- us which (venue / artist / organiser / event) and target_id points
-- at the corresponding row. We don't use FKs for target_id because it
-- references four different tables — application logic handles
-- referential cleanup via a delete cascade hook on each entity table.
--
-- notification_prefs is a small jsonb blob on profiles so we don't
-- need a separate table for "user X wants email Y". Defaults to
-- everything on; Phase 2 adds a UI to toggle each.

CREATE TABLE IF NOT EXISTS public.favourites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('venue', 'artist', 'organiser', 'event')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS favourites_user_type_idx
  ON public.favourites(user_id, target_type);
CREATE INDEX IF NOT EXISTS favourites_target_idx
  ON public.favourites(target_type, target_id);

-- ---- RLS --------------------------------------------------------------------
-- A favourite is private to the user who created it. Phase 2 may relax this
-- for social features (e.g. "show me who else is going") but that's later.
ALTER TABLE public.favourites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favourites_own_select" ON public.favourites;
CREATE POLICY "favourites_own_select" ON public.favourites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "favourites_own_insert" ON public.favourites;
CREATE POLICY "favourites_own_insert" ON public.favourites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "favourites_own_delete" ON public.favourites;
CREATE POLICY "favourites_own_delete" ON public.favourites
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---- Notification preferences ---------------------------------------------
-- jsonb blob keyed by notification category. Default all true; users opt out
-- via the (Phase 2) preferences page. New categories added later default to
-- true unless explicitly set to false in the user's row.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb
  NOT NULL DEFAULT '{
    "new_gig_at_favourite_venue": true,
    "new_gig_with_favourite_artist": true,
    "new_gig_from_favourite_organiser": true,
    "morning_of_reminder": true,
    "fifteen_minute_reminder": true
  }'::jsonb;


-- ===================== sql/041_notifications_sent.sql =====================
-- Phase 2: idempotent notification log.
--
-- Whenever a cron fires a notification email we insert a row here. The
-- UNIQUE constraint on (user_id, notification_type, event_id) ensures
-- the same email never gets sent twice for the same combo — important
-- because crons retry on failure and we don't want to spam users.
--
-- For non-event notifications (e.g. future "weekly digest"), event_id
-- can be NULL and dedup happens at the type+user level on a per-day
-- basis using sent_at.

CREATE TABLE IF NOT EXISTS public.notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Composite unique only when event_id is set. Using a partial unique
  -- index because a NULL in the multi-column UNIQUE would let dupes
  -- through; this enforces "one notification of this type per user per
  -- event" but leaves room for non-event notification types.
  UNIQUE NULLS NOT DISTINCT (user_id, notification_type, event_id)
);

CREATE INDEX IF NOT EXISTS notifications_sent_user_idx
  ON public.notifications_sent(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS notifications_sent_event_idx
  ON public.notifications_sent(event_id)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;

-- Users can see their own notification history (Phase 3 may expose this
-- in /dashboard/notifications for "what have we emailed you" visibility).
DROP POLICY IF EXISTS "notifications_own_select" ON public.notifications_sent;
CREATE POLICY "notifications_own_select" ON public.notifications_sent
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts only happen via the service-role client from cron routes —
-- no policy needed for authenticated INSERT.


-- ===================== sql/042_fan_signup_role.sql =====================
-- Fix: signup trigger mapped account_type='fan' to role='venue_owner'.
--
-- The CASE in handle_new_user_account_type (sql/024) only knew about
-- artist / organiser / venue and had an ELSE clause that fell through
-- to venue_owner — so every "Just a fan" signup landed in the profiles
-- table with role='venue_owner'. The user shows up in admin as a venue
-- when they're really a punter who just wants to favourite gigs.
--
-- This migration:
--   1. Replaces the trigger function with one that knows about 'fan'
--      and defaults unknown values to the lightweight 'user' role
--      (which is what fans should be).
--   2. Backfills profiles where raw_user_meta_data.account_type = 'fan'
--      but role was incorrectly set to venue_owner.

CREATE OR REPLACE FUNCTION public.handle_new_user_account_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  acct text := COALESCE(meta->>'account_type', 'fan');
  resolved_role text;
  artist_name text;
  norm_name text;
  base_slug text;
  candidate_slug text;
  attempt int := 0;
  has_similar_unclaimed boolean;
BEGIN
  resolved_role := CASE acct
    WHEN 'artist'    THEN 'artist'
    WHEN 'organiser' THEN 'event_organiser'
    WHEN 'venue'     THEN 'venue_owner'
    WHEN 'fan'       THEN 'user'
    ELSE 'user'  -- safer default — fans don't accidentally inherit ownership perms
  END;

  INSERT INTO public.profiles (id, email, display_name, role, created_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(meta->>'display_name', NULL),
    resolved_role,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email = excluded.email,
      display_name = COALESCE(excluded.display_name, profiles.display_name),
      role = CASE
        WHEN profiles.role IN ('venue_owner','user') THEN excluded.role
        ELSE profiles.role
      END;

  -- For artist signups: skip auto-create if there's already an unclaimed
  -- artist with a matching normalised name. (Behaviour unchanged from 024.)
  IF acct = 'artist' THEN
    artist_name := NULLIF(TRIM(COALESCE(meta->>'display_name', new.email)), '');
    IF artist_name IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.artists WHERE claimed_by = new.id
    ) THEN
      norm_name := LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(artist_name, '^the\s+', '', 'i'),
        '[^a-z0-9]+', '', 'g'
      ));

      SELECT EXISTS (
        SELECT 1 FROM public.artists a
        WHERE a.claimed_by IS NULL
          AND LENGTH(norm_name) >= 3
          AND LOWER(REGEXP_REPLACE(
                REGEXP_REPLACE(a.name, '^the\s+', '', 'i'),
                '[^a-z0-9]+', '', 'g'
              )) = norm_name
      ) INTO has_similar_unclaimed;

      IF NOT has_similar_unclaimed THEN
        base_slug := regexp_replace(
          regexp_replace(
            lower(replace(artist_name, '&', 'and')),
            '[^a-z0-9\s-]', '', 'g'
          ),
          '\s+', '-', 'g'
        );
        base_slug := regexp_replace(base_slug, '-+', '-', 'g');
        base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
        base_slug := substring(base_slug FOR 100);
        IF base_slug = '' THEN
          base_slug := 'artist';
        END IF;

        candidate_slug := base_slug;
        WHILE attempt < 8 LOOP
          BEGIN
            INSERT INTO public.artists (name, slug, claimed_by, approved)
            VALUES (artist_name, candidate_slug, new.id, true);
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            attempt := attempt + 1;
            candidate_slug := base_slug || '-' || (attempt + 1)::text;
          END;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- Backfill: anyone whose auth.users row says they signed up as a fan
-- but whose profile got mis-classified as venue_owner should be 'user'.
-- (We don't touch venue_owners who are real venue owners — the metadata
-- check ensures we only fix the bug victims.)
UPDATE public.profiles p
SET role = 'user'
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'venue_owner'
  AND COALESCE(u.raw_user_meta_data->>'account_type', '') = 'fan';


-- ===================== sql/043_auto_link_festival_venues.sql =====================
-- ----------------------------------------------------------------------------
-- 043: Auto-link festival_venues when an event references a festival
-- ----------------------------------------------------------------------------
-- The public venue page shows a "Taking part in [festival]" banner whenever
-- there's a festival_venues row linking the venue to a live festival. That
-- row is normally added by admin in the festival editor. But admins also
-- create events with `festival_id` set directly (festival schedule entry,
-- AI extraction, etc) — and used to forget to also add the venue to the
-- festival's venue list, so the banner wouldn't show.
--
-- This trigger closes that gap: any time an event row gets a festival_id +
-- venue_id pair, we INSERT into festival_venues with ON CONFLICT DO NOTHING.
-- Idempotent, race-safe, no surprises. SECURITY DEFINER because the user
-- inserting the event (venue owner, AI cron) won't have direct INSERT
-- permission on festival_venues — only admins do via RLS.
--
-- Also backfills existing events at the bottom so the rule applies
-- retroactively.

CREATE OR REPLACE FUNCTION public.auto_link_festival_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.festival_id IS NOT NULL AND NEW.venue_id IS NOT NULL THEN
    INSERT INTO public.festival_venues (festival_id, venue_id)
    VALUES (NEW.festival_id, NEW.venue_id)
    ON CONFLICT (festival_id, venue_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Replace any prior definition (idempotent re-runs).
DROP TRIGGER IF EXISTS events_auto_link_festival_venue ON public.events;

-- Fire on both INSERT and UPDATE — an event might initially have no
-- festival_id and later get reassigned to a festival, in which case we
-- still want the venue link to materialise.
CREATE TRIGGER events_auto_link_festival_venue
  AFTER INSERT OR UPDATE OF festival_id, venue_id ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_festival_venue();

-- ---- Backfill --------------------------------------------------------------
-- Any existing event with a festival_id + venue_id pair should also have
-- the corresponding festival_venues row. ON CONFLICT DO NOTHING so this
-- migration is safe to re-run.
INSERT INTO public.festival_venues (festival_id, venue_id)
SELECT DISTINCT e.festival_id, e.venue_id
FROM public.events e
WHERE e.festival_id IS NOT NULL
  AND e.venue_id   IS NOT NULL
ON CONFLICT (festival_id, venue_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';


-- ===================== sql/044_welcome_emails.sql =====================
-- ----------------------------------------------------------------------------
-- 044: Welcome-email queue (post email-confirmation)
-- ----------------------------------------------------------------------------
-- Supabase Auth's built-in flow sends a confirmation email to verify the
-- address. Once they click that link, `auth.users.email_confirmed_at` flips
-- from NULL to a timestamp. That's the right moment to send a tailored
-- "welcome" email pointing the user at what they can do — favourite venues
-- (fan), claim a page (venue/artist/organiser owner), etc.
--
-- We don't send from inside the trigger directly — Postgres triggers can't
-- comfortably make HTTPS calls without pg_net. Instead we enqueue a row in
-- pending_welcome_emails; a small cron drains the queue every few minutes,
-- calls Resend, and marks the row sent_at.
--
-- The queue is keyed on user_id (PK) so each user gets at most one welcome
-- email — protects against a race where the user re-confirms after an
-- email change.

CREATE TABLE IF NOT EXISTS public.pending_welcome_emails (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  account_type   text        NOT NULL DEFAULT 'user',
  queued_at      timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  send_attempts  int         NOT NULL DEFAULT 0,
  last_error     text
);

CREATE INDEX IF NOT EXISTS pending_welcome_emails_unsent_idx
  ON public.pending_welcome_emails (queued_at)
  WHERE sent_at IS NULL;

-- Trigger function: when email_confirmed_at goes from NULL to set, queue.
-- account_type comes from raw_user_meta_data (set during signup) — falls
-- back to "user" (the default fan role) when missing, matching the role
-- mapping in sql/042.
CREATE OR REPLACE FUNCTION public.queue_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.pending_welcome_emails (user_id, email, account_type)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'account_type', 'user')
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_queue_welcome_email ON auth.users;
CREATE TRIGGER auth_users_queue_welcome_email
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_welcome_email();

-- Lock the table down — only the service role drains the queue.
ALTER TABLE public.pending_welcome_emails ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated, which is what we want.

NOTIFY pgrst, 'reload schema';


-- ===================== sql/045_festival_map_image.sql =====================
-- ============================================================
-- 045: Festival map image
--
-- Adds a separate map_image_url column so festivals can display an
-- illustrated site map / venue layout (e.g. MoFest's High Street
-- map showing stages, food trucks, kids rides).
--
-- This is distinct from:
--   - hero_image_url — the wide brand cover behind the landing hero
--   - logo_url       — the square brand mark used on cards
--
-- The map image gets rendered at the top of the public festival
-- page's "Map" tab, above the live Leaflet venue map.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS map_image_url text;

COMMENT ON COLUMN public.festivals.map_image_url IS
  'Illustrated site map / venue layout, uploaded by admin. Rendered above the Leaflet map on the public festival page.';


-- ===================== sql/046_festival_sponsor.sql =====================
-- ============================================================
-- 046: Festival sponsor link
--
-- One festival can have one headline sponsor (e.g. GoFibre for MoFest).
-- We point at the existing sponsors table rather than store the logo +
-- name on festivals directly, so sponsor changes (logo update, status
-- toggle) flow through automatically and the same advertiser can sponsor
-- multiple things.
--
-- Many-to-many isn't needed yet — one headline sponsor per festival is
-- the pattern we're seeing in the wild. Can be promoted to a join table
-- later if multi-sponsor billing becomes a thing.
--
-- ON DELETE SET NULL — deleting a sponsor doesn't delete the festival;
-- the slot just clears so the admin can pick a replacement.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_id uuid
    REFERENCES public.sponsors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS festivals_sponsor_idx
  ON public.festivals(sponsor_id) WHERE sponsor_id IS NOT NULL;

COMMENT ON COLUMN public.festivals.sponsor_id IS
  'Headline sponsor for this festival. Renders as a logo + name card on the festival landing page above the description. References the shared sponsors table.';


-- ===================== sql/047_push_device_tokens.sql =====================
-- ============================================================
-- 047: Expo push device tokens
--
-- Stores one row per (user, device) so we know where to deliver
-- push notifications from the mobile app. The mobile app calls
-- POST /api/push/register on login (and after token refresh) to
-- upsert its token here.
--
-- Token format: "ExponentPushToken[xxxxxxxxxxxxx]" (Expo standard)
--
-- Sends are best-effort and de-duplicated by Expo's push receipts —
-- if a token starts returning "DeviceNotRegistered" we delete the
-- row from src/lib/push.ts so we stop sending to dead devices.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token  text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- One row per device (token is the device identity). If two users
  -- sign into the same device the second signup "steals" the token.
  UNIQUE (expo_token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx
  ON public.device_tokens(user_id);

-- ---- RLS --------------------------------------------------------------------
-- Users can read / delete only their own tokens. Inserts happen via the
-- API endpoint with Bearer JWT auth so the user_id check is enforced
-- in the route handler too.
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_tokens_own_select" ON public.device_tokens;
CREATE POLICY "device_tokens_own_select" ON public.device_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_insert" ON public.device_tokens;
CREATE POLICY "device_tokens_own_insert" ON public.device_tokens
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_update" ON public.device_tokens;
CREATE POLICY "device_tokens_own_update" ON public.device_tokens
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_own_delete" ON public.device_tokens;
CREATE POLICY "device_tokens_own_delete" ON public.device_tokens
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.device_tokens IS
  'Expo push tokens registered by the mobile app on login. One row per device. Service role uses these to fan out push notifications via Expo''s push API; see src/lib/push.ts.';


-- ===================== sql/048_festival_accepting_artists.sql =====================
-- ============================================================
-- 048: Festival "accepting artist submissions" toggle
--
-- Controls whether the "Want to be involved?" / "Want to play?" CTAs
-- show on the public festival page. When false, the festival is full
-- and the banner + ArtistsGrid empty-state CTA are hidden, even if a
-- contact_email is set. The contact_email itself stays so admin can
-- still see who to reach out to from the back office.
--
-- Defaults to true so existing festivals don't suddenly lose their
-- "want to play" banner on next render.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS accepting_artists boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.festivals.accepting_artists IS
  'When false, hides the "Want to be involved / Want to play" CTAs on the public festival page. Use when the festival lineup is full.';


-- ===================== sql/049_festival_external_sponsor.sql =====================
-- ============================================================
-- 049: Festival standalone sponsor fields
--
-- Festivals often have their own headline sponsor (e.g. GoFibre for
-- MoFest) that has no relationship to The Buzz Guide's own advertising
-- programme — the festival organiser arranged it themselves. We were
-- previously pointing festival.sponsor_id at the shared `sponsors`
-- table, which forced these external-to-The-Buzz arrangements to be
-- materialised as Buzz advertisers (showing up in the rotating
-- homepage banner, /sponsors directory etc.). Wrong.
--
-- This adds three nullable columns directly on festivals so an admin
-- can type the sponsor's name + upload their logo + paste their URL
-- without polluting the Buzz sponsors table.
--
-- The legacy sponsor_id column stays in place (no drop) so old data
-- isn't lost, but the public page + admin form switch to the new
-- columns. We can drop sponsor_id later once we're sure no festival
-- relies on it.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_name text;

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_logo_url text;

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS sponsor_url text;

COMMENT ON COLUMN public.festivals.sponsor_name IS
  'Standalone festival sponsor display name (e.g. "GoFibre"). Not linked to Buzz sponsors. Renders alongside sponsor_logo_url + sponsor_url on the public festival page.';

COMMENT ON COLUMN public.festivals.sponsor_logo_url IS
  'Standalone festival sponsor logo image. Public URL, typically from Supabase Storage under festivals/<id>/sponsor-*.';

COMMENT ON COLUMN public.festivals.sponsor_url IS
  'Standalone festival sponsor click-through URL. Optional — sponsor card renders unlinked when empty.';


-- ===================== sql/050_sponsor_show_on_app.sql =====================
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


-- ===================== sql/051_festival_hero_position.sql =====================
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


-- ===================== sql/052_device_tokens_anonymous.sql =====================
-- ============================================================
-- 052: Anonymous device tokens
--
-- Lets the mobile app register its Expo push token BEFORE the user
-- signs in (or even creates an account). Existing flow only stored
-- tokens linked to a user_id; the new flow stores user_id = NULL for
-- anonymous devices and upgrades them to a real user_id later when
-- the user signs in (UPSERT on expo_token).
--
-- Use case: admin broadcasts to "everyone with the app" — including
-- the long tail of users who downloaded but never registered.
--
-- RLS: anonymous rows can't be inserted via the JS client (RLS would
-- block them — the INSERT policy requires auth.uid() = user_id which
-- is impossible when user_id is NULL). Anonymous inserts must go
-- through the /api/push/register endpoint which uses the service
-- client to bypass RLS. The endpoint itself is open (no Bearer
-- required), which is fine — the worst a hostile actor could do is
-- register a junk Expo token, and Expo's push API quietly drops
-- DeviceNotRegistered.
-- ============================================================

ALTER TABLE public.device_tokens
  ALTER COLUMN user_id DROP NOT NULL;

-- Existing user_idx is fine for user-linked rows; add a partial index
-- for the "find all anonymous tokens" query the broadcast uses.
CREATE INDEX IF NOT EXISTS device_tokens_anonymous_idx
  ON public.device_tokens(last_seen_at)
  WHERE user_id IS NULL;

COMMENT ON COLUMN public.device_tokens.user_id IS
  'Owner of this device token. NULL = anonymous registration (app installed but not signed in). Becomes set when the user signs in and the mobile app re-registers the same expo_token with Bearer auth.';


-- ===================== sql/053_sponsor_outreach_leads.sql =====================
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


-- ===================== sql/054_festival_layout_mode.sql =====================
-- ============================================================
-- 054: Festival layout mode + programme content
--
-- Some festivals (Bruce, smaller community ones) happen in a single
-- park with multiple "arenas" or zones rather than across multiple
-- separate venues. For those, the existing multi-venue tabs don't fit:
-- Venues shows "0 VENUES", Map shows nothing useful, and the meaty
-- content (arena timetables, parking, all-day attractions) has
-- nowhere to live.
--
-- This adds a per-festival layout toggle:
--   • multi_venue (default) — current behaviour: Schedule/Venues/Artists/Map/My picks
--   • programme              — Schedule/Programme/Artists/My picks, no Venues, no Map
--
-- `programme_content` holds the long-form markdown shown in the new
-- Programme tab. Plain festivals can leave it empty.
-- ============================================================

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS layout_mode text NOT NULL DEFAULT 'multi_venue'
    CHECK (layout_mode IN ('multi_venue', 'programme'));

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS programme_content text;

COMMENT ON COLUMN public.festivals.layout_mode IS
  'Page layout. multi_venue = default tabs (Schedule/Venues/Artists/Map/Picks). programme = single-park festivals: shows a Programme tab with markdown content and hides Venues/Map tabs.';

COMMENT ON COLUMN public.festivals.programme_content IS
  'Markdown content for the Programme tab — arena timetables, all-day attractions, travel info. Only shown when layout_mode = programme. Same markdown features as description.';


-- ===================== sql/055_festival_hero_opacity.sql =====================
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


-- ===================== sql/056_festival_lineup.sql =====================
-- ============================================================
-- 056: Festival lineup
--
-- A way for admins to type in a festival's lineup without going
-- through the full event + venue setup. Each row pairs an artist
-- with a performance time + stage for a specific festival.
--
-- Why a junction table instead of just packing names into the
-- description: typing "Kyle Falconer" in the admin form upserts
-- a real `artists` row (slugified, approved) so visitors get a
-- real /artists/kyle-falconer page that lists their festival
-- appearance. The lineup row links the two with the timing info.
--
-- An artist can appear at the same festival twice (e.g. soundcheck
-- at 4pm and headline at 9pm), so we don't enforce uniqueness
-- across (festival, artist). Distinct rows are fine.
--
-- ON DELETE CASCADE on both sides — deleting a festival or an
-- artist cleans up their lineup entries automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.festival_lineup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id uuid NOT NULL REFERENCES public.festivals(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  -- NULL = TBA. Otherwise full timestamp so we can sort
  -- chronologically and group by day on the public page.
  performance_time timestamptz,
  -- Free-text label: "Music Zone", "Main Stage", "Arena 2", etc.
  -- NULL when the festival has no concept of multiple stages.
  stage text,
  -- For acts with no performance_time, admin can still control order.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS festival_lineup_festival_idx
  ON public.festival_lineup(festival_id);
CREATE INDEX IF NOT EXISTS festival_lineup_artist_idx
  ON public.festival_lineup(artist_id);
-- Chronological ordering query — `WHERE festival_id = ? ORDER BY performance_time`
CREATE INDEX IF NOT EXISTS festival_lineup_time_idx
  ON public.festival_lineup(festival_id, performance_time NULLS LAST, sort_order);

ALTER TABLE public.festival_lineup ENABLE ROW LEVEL SECURITY;

-- Public-read so the festival landing page (server component, no auth
-- token) can load the lineup. Writes go through the admin server
-- actions which use the service client.
DROP POLICY IF EXISTS "festival_lineup_public_read" ON public.festival_lineup;
CREATE POLICY "festival_lineup_public_read"
  ON public.festival_lineup
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.festival_lineup IS
  'Per-festival typed-in lineup. Each row links a festival to an artist with a performance time + stage. Auto-creates artist rows on the fly when admin types a new name so each act gets a real /artists/<slug> page.';


-- ===================== sql/057_fife_region.sql =====================
-- ============================================================
-- 057: Add the Fife region.
--
-- Models the same way Angus does: one `cities` row with slug `fife`
-- and a `nearby_areas` array listing every town/village the region
-- covers. The public city page renders "Covering X, Y, Z…" from
-- nearby_areas automatically, and the site importer / event scraper
-- uses the array to decide which Fife-region events belong on the
-- /fife page.
--
-- Includes the four headline towns (Dunfermline, Glenrothes,
-- Kirkcaldy, St Andrews) plus a sensible second tier:
--   • Forth-coast commuter belt: Inverkeithing, Rosyth, Aberdour
--   • Levenmouth (the train line just reopened): Leven
--   • Central Fife with an actual venue: Lochgelly, Cowdenbeath
--   • East Neuk: Anstruther (covers the wider East Neuk gigs)
--   • Cupar — historic market town with a few pubs
--
-- Easy to extend later by editing the array via /admin/cities or a
-- follow-up migration — keep adding villages as events surface there.
--
-- Idempotent: safe to re-run.
-- ============================================================

insert into public.cities (name, slug, active, nearby_areas)
values (
  'Fife',
  'fife',
  true,
  array[
    -- Major towns
    'Dunfermline',
    'Glenrothes',
    'Kirkcaldy',
    'St Andrews',
    -- Second-tier towns with venues / pub scenes worth listing
    'Cupar',
    'Leven',
    'Burntisland',
    'Lochgelly',
    'Cowdenbeath',
    'Anstruther',
    'Aberdour',
    'Inverkeithing',
    'Rosyth'
  ]
)
on conflict (slug) do update
  set name = excluded.name,
      active = excluded.active,
      nearby_areas = excluded.nearby_areas;

notify pgrst, 'reload schema';


-- ===================== sql/058_fb_scrape_venue_runs.sql =====================
-- ============================================================
-- 058: FB scrape per-venue run log
--
-- Logs one row per (venue, cron iteration) so the admin can see WHY
-- a day produced 0 events: did Apify return no posts, did Anthropic
-- error, did the AI find nothing, or did dedup catch every extraction?
--
-- The cron's response already carries `perVenue: [{venue, posts,
-- events, skipped, error}]` but it's only in-memory — once the chain
-- finishes there's no record of what happened where. Persisting to
-- this table fills the gap.
--
-- Volume estimate: 253 venues × 2 scheduled runs/week ≈ 26k rows/year,
-- plus manual triggers. Tiny by Postgres standards. Index on ran_at
-- so the dashboard's daily-rollup query is fast.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fb_scrape_venue_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  -- NULL when the venue has since been deleted — keep the row for
  -- the historical record but don't cascade-delete it.
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  -- Snapshot the name so the row remains readable even if venue_id
  -- goes NULL or the venue is renamed.
  venue_name text NOT NULL,
  -- For city-scoped daily aggregates (no expensive joins needed).
  city_slug text,
  -- Counts from the cron's per-venue summary.
  posts int NOT NULL DEFAULT 0,
  events_created int NOT NULL DEFAULT 0,
  events_skipped int NOT NULL DEFAULT 0,
  -- Error message from extractEvents / scrapeVenueFacebook, NULL when
  -- the venue processed cleanly. Truncated to 1000 chars at insert.
  error text,
  -- Was this run triggered with ?force=1 (bypassing the 12h cooldown)?
  -- Lets us tell scheduled runs apart from manual debug triggers.
  forced boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_ran_at_idx
  ON public.fb_scrape_venue_runs(ran_at DESC);
CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_venue_idx
  ON public.fb_scrape_venue_runs(venue_id);
-- Partial index: rows with errors, ordered newest-first. Lets the
-- dashboard's "today's errors" query stay fast even as the table grows.
CREATE INDEX IF NOT EXISTS fb_scrape_venue_runs_errors_idx
  ON public.fb_scrape_venue_runs(ran_at DESC)
  WHERE error IS NOT NULL;

ALTER TABLE public.fb_scrape_venue_runs ENABLE ROW LEVEL SECURITY;

-- Admin-only read. Writes go through the cron route's service client
-- which bypasses RLS, so the policy is belt-and-braces.
DROP POLICY IF EXISTS "fb_scrape_venue_runs_admin_read" ON public.fb_scrape_venue_runs;
CREATE POLICY "fb_scrape_venue_runs_admin_read"
  ON public.fb_scrape_venue_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

COMMENT ON TABLE public.fb_scrape_venue_runs IS
  'Per-venue run log for the FB scrape cron. One row per (venue, cron iteration). Powers the daily Skipped / Errors columns on /admin/cron-runs and lets admins spot-check why a day produced 0 events.';

notify pgrst, 'reload schema';


-- ===================== sql/059_venues_last_event_imported_at.sql =====================
-- ============================================================
-- 059: Track when each venue last had an event imported
--
-- Lets the FB scrape cron skip venues that are clearly dormant.
-- "Dormant" = no event landed for this venue in the last 90 days,
-- which strongly suggests scraping their FB page is unproductive
-- (they're either a pub that doesn't do gigs, a closed venue, or
-- a FB page that's gone silent).
--
-- We use event `created_at` not `start_time` — what we care about is
-- "when did the system last find a gig here", not "when did their
-- last gig happen". A venue could have hosted nothing for 6 months
-- but their FB page suddenly post next month's gig list; we want to
-- catch that, so the column updates the instant the cron writes a
-- row, not based on the gig date.
--
-- Backfilled from existing events. Auto-updated by a trigger on
-- event INSERT so the column stays accurate without any app changes.
-- ============================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS last_event_imported_at timestamptz;

-- Backfill: for every venue with any events, set this to the most
-- recent event's created_at. Venues with no events leave it NULL,
-- which the cron treats as "dormant" too.
UPDATE public.venues v
SET last_event_imported_at = sub.last_at
FROM (
  SELECT venue_id, MAX(created_at) AS last_at
  FROM public.events
  WHERE venue_id IS NOT NULL
  GROUP BY venue_id
) sub
WHERE v.id = sub.venue_id
  AND v.last_event_imported_at IS DISTINCT FROM sub.last_at;

-- Index: the cron's "is this venue dormant?" filter compares against
-- a moving 90-day cutoff. DESC NULLS LAST so the "newest event" query
-- is cheap, and the predicate filter on dormancy is index-supported.
CREATE INDEX IF NOT EXISTS venues_last_event_imported_at_idx
  ON public.venues(last_event_imported_at DESC NULLS LAST);

-- Trigger: keep the column up to date as the cron / admin / paste-
-- fixtures tools land new events. Only fires on INSERT — UPDATE-ing
-- a start_time on an existing event doesn't change "when we last
-- found a gig here". DELETE is intentionally not handled (deleting
-- the only event from a venue doesn't make it dormant retroactively;
-- the field just stays stale and the venue's still scraped at the
-- normal cadence until 90 days pass).
CREATE OR REPLACE FUNCTION public.bump_venue_last_event_imported_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    UPDATE public.venues
    SET last_event_imported_at = GREATEST(
      COALESCE(last_event_imported_at, NEW.created_at),
      NEW.created_at
    )
    WHERE id = NEW.venue_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_bump_venue_last_imported ON public.events;
CREATE TRIGGER events_bump_venue_last_imported
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.bump_venue_last_event_imported_at();

COMMENT ON COLUMN public.venues.last_event_imported_at IS
  'Timestamp when an event was last created (inserted) for this venue, regardless of when the gig itself happens. Used by the FB scrape cron to identify dormant venues — those with no recent event imports get scraped on a longer cooldown to save Apify cost without losing coverage of venues that actually produce content.';

notify pgrst, 'reload schema';


-- ===================== sql/060_move_tayport_newport_to_fife.sql =====================
-- ============================================================
-- 060: Move Tayport + Newport-on-Tay venues from Dundee → Fife
--
-- Tayport and Newport-on-Tay sit on the Fife side of the Tay
-- Bridge — geographically they're in the Fife council area, not
-- Dundee. When sql/057 added Fife as its own region it didn't
-- include these two villages, so existing venues at those
-- addresses are still tagged with Dundee's city_id.
--
-- This migration:
--   1. Adds Tayport + Newport-on-Tay to Fife's `nearby_areas`
--      array so future events / venue imports in those towns
--      route to /fife automatically.
--   2. Reassigns any existing venue whose address mentions
--      Tayport or Newport-on-Tay from Dundee → Fife.
--
-- Match is by `address ILIKE` rather than postcode because
-- the address field is always present, while postcodes may be
-- blank on legacy venue rows. Covers common spelling variants
-- ("Newport-on-Tay", "Newport on Tay", "Newport, Fife").
--
-- Idempotent: safe to re-run. `array_append` only adds the town
-- if not already present; the venue UPDATE no-ops when city_id
-- is already Fife.
-- ============================================================

-- 1. Extend Fife's nearby_areas with the two North Fife villages
update public.cities
   set nearby_areas = (
     -- De-duplicating set-builder: combine the existing array with the
     -- two new entries, drop duplicates, sort. Stops a re-run from
     -- producing "Tayport, Tayport".
     select array(
       select distinct unnest(nearby_areas || array['Tayport', 'Newport-on-Tay'])
     )
   )
 where slug = 'fife';

-- 2. Reassign matching venues from Dundee → Fife.
--    Both subqueries are scalar — there's only one row per slug.
update public.venues
   set city_id = (select id from public.cities where slug = 'fife')
 where city_id = (select id from public.cities where slug = 'dundee')
   and (
     address ilike '%Tayport%'
     or address ilike '%Newport-on-Tay%'
     or address ilike '%Newport on Tay%'
     or address ilike '%Newport, Fife%'
   );

notify pgrst, 'reload schema';


-- ===================== sql/061_move_fife_towns_to_fife.sql =====================
-- ============================================================
-- 061: Bulk-reassign Fife-area venues to the Fife region
--
-- When Fife was added (sql/057) only the cities row got created.
-- Venues that geographically belong to Fife (Anstruther, Dunfermline,
-- Kirkcaldy, St Andrews, Cupar, Burntisland etc.) were still tagged
-- to whatever city they were originally imported under — usually
-- Dundee or NULL — so a `?city=fife` scoped scrape silently skipped
-- them and they didn't appear on /fife at all.
--
-- This migration finds every venue whose address mentions a Fife
-- town from the official nearby_areas list and re-tags its city_id
-- to Fife. Two safety guards:
--   • Only moves venues currently tagged to a different city (or
--     NULL). Venues already on Fife stay put.
--   • Match is case-insensitive against the address text. We don't
--     touch venues without a populated address (no signal to act on).
--
-- Idempotent: re-running is a no-op because all matching venues
-- already have city_id = fife after the first pass.
-- ============================================================

-- Lock the Fife id once so the UPDATE below is a single scalar.
WITH fife AS (
  SELECT id FROM public.cities WHERE slug = 'fife'
)
UPDATE public.venues v
SET city_id = (SELECT id FROM fife)
WHERE
  -- Don't touch venues already on Fife.
  (v.city_id IS DISTINCT FROM (SELECT id FROM fife))
  AND v.address IS NOT NULL
  AND (
    v.address ILIKE '%Dunfermline%'
    OR v.address ILIKE '%Glenrothes%'
    OR v.address ILIKE '%Kirkcaldy%'
    OR v.address ILIKE '%St Andrews%'
    OR v.address ILIKE '%St. Andrews%'        -- common variant with period
    OR v.address ILIKE '%Cupar%'
    OR v.address ILIKE '%Leven%'
    OR v.address ILIKE '%Burntisland%'
    OR v.address ILIKE '%Lochgelly%'
    OR v.address ILIKE '%Cowdenbeath%'
    OR v.address ILIKE '%Anstruther%'
    OR v.address ILIKE '%Aberdour%'
    OR v.address ILIKE '%Inverkeithing%'
    OR v.address ILIKE '%Rosyth%'
    OR v.address ILIKE '%Tayport%'             -- belt-and-braces; sql/060 already did these
    OR v.address ILIKE '%Newport-on-Tay%'
    OR v.address ILIKE '%Newport on Tay%'
  );

notify pgrst, 'reload schema';


-- ===================== sql/062_festival_sponsors.sql =====================
-- ============================================================
-- 062: Festival sponsors
--
-- Per-festival list of extra sponsors. The existing flat columns
-- on festivals (sponsor_name / sponsor_logo_url / sponsor_url)
-- stay put as the ONE headline sponsor — this table is for the
-- "With thanks to" grid of additional supporters below it.
--
-- Why a separate table instead of a JSON array on festivals:
--   • Logo URLs are user-uploaded via the admin's ImageUploader.
--     Storing them as separate rows means each sponsor's logo can
--     be re-uploaded / replaced without rewriting the whole festival
--     row.
--   • Display order is mutable — admin can drag to reorder. A
--     dedicated row with a sort_order int makes that a one-row
--     UPDATE instead of a re-serialise of a JSON array.
--   • Future: per-sponsor click tracking would need its own ID.
--
-- ON DELETE CASCADE — deleting a festival drops its sponsors.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.festival_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id uuid NOT NULL REFERENCES public.festivals(id) ON DELETE CASCADE,
  -- Display name shown under (or as alt text on) the logo.
  -- Required because some logos are illegible without a label,
  -- and screen readers / fallback rendering need it.
  name text NOT NULL,
  -- The sponsor's logo image. Optional — if missing we'll just
  -- render the name as text on the public page.
  logo_url text,
  -- Where to link to when someone clicks the logo. Optional —
  -- if missing the logo renders as a non-clickable image.
  url text,
  -- Admin-controlled order. Lower numbers render first. Multiple
  -- rows can share a value; we just fall back to created_at as a
  -- stable secondary sort.
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS festival_sponsors_festival_idx
  ON public.festival_sponsors(festival_id);
-- Ordering query — `WHERE festival_id = ? ORDER BY sort_order, created_at`
CREATE INDEX IF NOT EXISTS festival_sponsors_order_idx
  ON public.festival_sponsors(festival_id, sort_order, created_at);

ALTER TABLE public.festival_sponsors ENABLE ROW LEVEL SECURITY;

-- Public-read so the festival landing page (server component, no auth
-- token) can load the sponsor grid. Writes go through the admin
-- server actions which use the service client.
DROP POLICY IF EXISTS "festival_sponsors_public_read" ON public.festival_sponsors;
CREATE POLICY "festival_sponsors_public_read"
  ON public.festival_sponsors
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.festival_sponsors IS
  'Extra sponsors for a festival (the "with thanks to" grid). The headline sponsor stays as the flat sponsor_name/sponsor_logo_url/sponsor_url columns on the festivals table.';


-- ===================== sql/063_fan_signup_role.sql =====================
-- ============================================================
-- The Buzz Guide: fix fan signups being mis-classified as venue_owner.
--
-- Background: the handle_new_user() trigger added in 008 maps the
-- account_type from signup metadata onto profiles.role. The case
-- statement only handled 'artist' / 'organiser' / 'venue' — anything
-- else (including 'fan', which was added later as a signup option)
-- fell into the `else` branch and got written as 'venue_owner'.
--
-- This migration:
--   1. Updates the trigger to map 'fan' → 'user' (fans are just regular
--      users in the system — no special role chip needed).
--   2. Backfills any existing fan accounts that were mis-labelled as
--      venue_owner by looking at their auth.users metadata.
--
-- Safe to re-run.
-- ============================================================

-- 1. Re-create the trigger function with 'fan' handled explicitly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  acct text := coalesce(meta->>'account_type', 'venue');
  resolved_role text;
begin
  -- Map account_type from signup form to a real role
  resolved_role := case acct
    when 'artist'    then 'artist'
    when 'organiser' then 'event_organiser'
    when 'venue'     then 'venue_owner'
    when 'fan'       then 'user'
    else 'venue_owner'
  end;

  insert into public.profiles (id, email, display_name, role, created_at)
  values (
    new.id,
    new.email,
    coalesce(meta->>'display_name', null),
    resolved_role,
    now()
  )
  on conflict (id) do update
    set
      email = excluded.email,
      display_name = coalesce(excluded.display_name, profiles.display_name),
      -- only overwrite role if the existing one is still the default
      role = case
        when profiles.role in ('venue_owner','user') then excluded.role
        else profiles.role
      end;

  return new;
end;
$$;

-- 2. Backfill: any account whose signup metadata says 'fan' but whose
--    profile role is still the default 'venue_owner' should be 'user'.
update public.profiles p
set role = 'user'
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data->>'account_type' = 'fan'
  and p.role = 'venue_owner';

-- ============================================================
-- DONE. New behaviour:
--   * Fan signups now correctly land as role = 'user' in profiles
--   * Existing mis-classified fan accounts have been re-labelled
--   * Admin user list will show them as "user" instead of "venue"
-- ============================================================


-- ===================== sql/065_split_tribute_acoustic_genres.sql =====================
-- ============================================================
-- 065: Split combined "Tribute / Covers" and "Acoustic /
--      Singer-Songwriter" genres into their narrower parts.
--
-- Background:
--   sql/032 consolidated "Tribute Acts" into "Tribute / Covers"
--   (slug = covers). That was a mistake — a tribute act ("ABBA
--   Mania") is quite different from a covers band ("Beatles Covers
--   Trio"), and admin / venue filters benefit from telling them
--   apart. Same story for "Acoustic / Singer-Songwriter": an
--   acoustic rock cover trio isn't the same kind of booking as a
--   solo writer of original songs.
--
-- What this migration does:
--   1. Renames "Tribute / Covers" (slug = covers) to just "Cover
--      bands" (slug stays `covers`). Adds a new sibling "Tribute
--      acts" (slug = tribute).
--   2. Renames "Acoustic / Singer-Songwriter" (slug = acoustic) to
--      just "Acoustic" (slug stays `acoustic`). Adds a new sibling
--      "Singer-songwriter" (slug = singer-songwriter).
--
-- Existing event_genres tags are NOT migrated. Events tagged with
-- the old combined name carry over to the renamed-narrower one
-- (covers stays covers, acoustic stays acoustic). When the admin
-- spots an event that should be on the new sibling instead, they
-- re-tag it from the admin Events tool.
--
-- Idempotent — safe to re-run. The pickEventIcon() helper already
-- supports all four slugs separately, so no app code change is
-- required to ship this.
-- ============================================================

-- 1. Rename "Tribute / Covers" → "Cover bands"
update public.genres
   set name = 'Cover bands'
 where slug = 'covers'
   and name <> 'Cover bands';

-- 2. Add new "Tribute acts" (slug = tribute) if not already present.
--    Some legacy deploys may still have a `tribute` row from pre-sql/032;
--    the ON CONFLICT clause handles that safely.
insert into public.genres (name, slug)
values ('Tribute acts', 'tribute')
on conflict (slug) do update set name = excluded.name;

-- 3. Rename "Acoustic / Singer-Songwriter" → "Acoustic"
update public.genres
   set name = 'Acoustic'
 where slug = 'acoustic'
   and name <> 'Acoustic';

-- 4. Add new "Singer-songwriter" (slug = singer-songwriter)
insert into public.genres (name, slug)
values ('Singer-songwriter', 'singer-songwriter')
on conflict (slug) do update set name = excluded.name;

-- Bust PostgREST's schema cache so the new rows are picked up
-- immediately without a deploy.
notify pgrst, 'reload schema';


-- ===================== sql/066_kids_event_fields.sql =====================
-- =====================================================================
-- 066 — Kids' event fields  (The Buzz Kids fork)
-- =====================================================================
-- The Buzz Guide models single-night gigs. Kids'/family events need a
-- richer shape: who it's for (age), what it costs + whether you must
-- pre-book, indoor vs outdoor (rain backup), multi-day / recurring runs
-- (a camp runs Mon–Fri; a club runs weekly for 6 weeks), and the
-- accessibility / sensory facets parents filter on hard.
--
-- All additive + idempotent (`add column if not exists`), so it's safe
-- to run on a fresh DB after schema.sql + the existing 002–065 chain.
-- It also re-seeds the `genres` taxonomy (reused as activity CATEGORIES
-- for this product) from music genres to kid-activity categories.
-- =====================================================================

-- 1. EVENT FIELDS -----------------------------------------------------

-- Age suitability, in YEARS. age_min 0 = suitable from birth (baby/toddler).
-- NULL on either side = open-ended (no lower / no upper bound, i.e. all ages).
alter table public.events add column if not exists age_min smallint;
alter table public.events add column if not exists age_max smallint;

-- Pricing. cover_charge (existing text col) stays the human display string
-- ("Free", "£5", "£8 / £6 conc"). These two are for FILTERING only.
alter table public.events add column if not exists is_free boolean not null default false;
alter table public.events add column if not exists price_from numeric(7,2); -- lowest £ price; NULL = unknown

-- Booking. ticket_url (existing) doubles as the booking link.
alter table public.events add column if not exists booking_required boolean not null default false;

-- Indoor / outdoor — the rain-backup filter.
alter table public.events add column if not exists setting text
  check (setting is null or setting in ('indoor','outdoor','both'));

-- Multi-day & recurring runs.
--   end_date           — last day of a multi-day run (Mon–Fri camp). NULL = single day.
--   recurrence_pattern — normalised cadence: 'weekdays' | 'weekly' | 'daily'
--                        | 'every_saturday' | 'every_sunday' | 'school_holidays' | ...
--                        NULL = one-off.
--   recurrence_until   — date a weekly/recurring series stops. NULL = open-ended.
alter table public.events add column if not exists end_date date;
alter table public.events add column if not exists recurrence_pattern text;
alter table public.events add column if not exists recurrence_until date;

-- Accessibility / sensory facets. Free-form text[] over an app-enforced
-- vocabulary (kept flexible in the DB so new facets don't need a migration):
--   'autism-friendly' | 'sensory-session' | 'quiet-space' | 'ear-defenders'
--   | 'changing-places' | 'carer-free' | 'wheelchair-accessible'
--   | 'buggy-friendly' | 'bsl' | 'makaton'
alter table public.events add column if not exists accessibility text[] not null default '{}';

-- 2. INDEXES FOR THE NEW FILTERS --------------------------------------
create index if not exists events_age_idx     on public.events (age_min, age_max);
create index if not exists events_is_free_idx on public.events (is_free);
create index if not exists events_setting_idx on public.events (setting);
create index if not exists events_end_date_idx on public.events (end_date);
-- GIN for "has any of these accessibility facets" (&&) / "has all" (@>).
create index if not exists events_accessibility_idx on public.events using gin (accessibility);

-- 3. ACTIVITY CATEGORIES (reuses the `genres` table) ------------------
-- Fresh-DB safe: at fork time no events reference any genre yet, so we
-- clear the inherited music genres and seed kid-activity categories.
-- (event_genres has ON DELETE CASCADE, so this is clean on an empty DB.)
delete from public.genres;

insert into public.genres (name, slug) values
  ('Soft play',                'soft-play'),
  ('Trampoline park',          'trampoline'),
  ('Farms & animals',          'farm-animals'),
  ('Zoos & aquariums',         'zoo-aquarium'),
  ('Library & story time',     'library'),
  ('Arts & crafts',            'arts-crafts'),
  ('Museums & galleries',      'museum-gallery'),
  ('Theatre & shows',          'theatre'),
  ('Cinema & screenings',      'cinema'),
  ('Music & singing',          'music-singing'),
  ('Dance',                    'dance'),
  ('Drama & performance',      'drama'),
  ('Multi-sport camp',         'sports-camp'),
  ('Football',                 'football'),
  ('Swimming',                 'swimming'),
  ('STEM & coding',            'stem-coding'),
  ('Outdoor & adventure',      'outdoor-adventure'),
  ('Forest & nature',          'forest-nature'),
  ('Holiday club',             'holiday-club'),
  ('Baby & toddler groups',    'toddler-group'),
  ('Sensory play',             'sensory'),
  ('Days out & attractions',   'days-out'),
  ('Seasonal & festive',       'seasonal'),
  ('Fairs & funfairs',         'fun-fair'),
  ('Free activities',          'free-play')
  on conflict (slug) do nothing;

