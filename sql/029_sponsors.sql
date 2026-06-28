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
