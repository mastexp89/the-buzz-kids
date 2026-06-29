-- ============================================================
-- The Buzz Kids: offers & deals (NOT places).
-- Standing money-saving deals for families — "kids eat for £1",
-- "kids go free", etc. These are deal info only; they do NOT create
-- venue/place records. Two kinds: 'food' (eating out) and
-- 'days-out' (attractions/travel).
-- Run once in Supabase SQL editor. Safe to re-run (seed is idempotent
-- on the unique title).
-- ============================================================

create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('food', 'days-out')),
  title       text not null,
  provider    text,                 -- the business / chain (e.g. "Asda Café")
  description text,
  terms       text,                 -- the small print, in plain English
  url         text,                 -- where to find / claim it
  scope       text not null default 'national' check (scope in ('national', 'local')),
  city_id     uuid references public.cities(id),  -- set only for local offers
  approved    boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  constraint offers_title_unique unique (title)
);

create index if not exists offers_category_idx on public.offers (category, approved);

alter table public.offers enable row level security;

drop policy if exists offers_public_read on public.offers;
create policy offers_public_read on public.offers for select
  using (approved = true or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists offers_admin_write on public.offers;
create policy offers_admin_write on public.offers for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------- Seed: reliable, year-round national deals ----------
insert into public.offers (category, title, provider, description, terms, url, scope, sort_order) values
  ('food', 'Kids eat for £1 at Asda Café', 'Asda Café', 'A hot kids'' meal for £1 when you dine in.', '16 and under. Dine in only, all day, every day. No minimum spend and no adult meal required.', 'https://www.asda.com/george/asda-cafe', 'national', 10),
  ('food', 'Kids'' meal free at Morrisons Café', 'Morrisons Café', 'A free kids'' meal with every adult main meal.', 'One free kids'' meal with each adult main meal costing £5 or more. Available all day, every day.', 'https://my.morrisons.com/cafe/', 'national', 20),
  ('food', 'Kids eat for £1 at Sainsbury''s Café', 'Sainsbury''s Café', 'A kids'' hot meal or lunch bag for £1 with an adult main.', 'One £1 kids'' hot meal or lunch bag with each adult hot main meal purchased.', 'https://www.sainsburys.co.uk/cafe', 'national', 30),
  ('food', 'Kids eat free at Tesco Café', 'Tesco Café', 'A free kids'' meal with any adult café purchase.', 'Clubcard members. One free kids'' meal with any adult item bought in café, Monday to Friday.', 'https://www.tesco.com/zones/cafe', 'national', 40),
  ('food', 'Kids'' main for £1 at Sizzling Pubs', 'Sizzling Pubs', 'A kids'' main meal for £1 with an adult meal.', 'One £1 kids'' main with each adult meal, Monday to Friday from 12pm.', 'https://www.sizzlingpubs.co.uk/', 'national', 50),
  ('food', 'Kids eat for £1 at Marston''s', 'Marston''s', 'Kids'' meals for £1 during the school holidays.', 'One £1 kids'' meal with an adult main meal during Scottish school holidays. Selected pubs.', 'https://www.marstons.co.uk/', 'national', 60),
  ('food', 'Kids eat free at Pizza Hut', 'Pizza Hut Restaurants', 'A free kids'' meal when you spend on other food.', 'One free kids'' meal when you spend £9.99 or more on other food, all day, every day.', 'https://www.pizzahut.co.uk/restaurants/', 'national', 70),
  ('days-out', 'Kids for a Quid + free attraction entry', 'ScotRail', 'Take up to 4 kids anywhere in Scotland for £1 each — and get free child entry at participating attractions.', 'Up to 4 children aged 5–15 travel for £1 each with a fare-paying adult. Show the ticket for one free child entry (with a full-price adult ticket) at participating attractions, including Deep Sea World.', 'https://www.scotrail.co.uk/tickets/kids-for-a-quid', 'national', 10),
  ('days-out', 'Days out with Tesco Clubcard', 'Tesco Clubcard', 'Turn Clubcard points into family days out for less.', 'Swap Clubcard vouchers for boosted-value entry to attractions across Scotland through Reward Partners.', 'https://www.tesco.com/clubcard/rewards/', 'national', 20),
  ('days-out', 'Family membership: unlimited castle & garden visits', 'Historic Environment Scotland', 'One family membership covers a year of visits to castles, abbeys and historic sites.', 'A family Explorer/membership pass covers entry for the year — handy if you visit a few paid attractions over the summer.', 'https://www.historicenvironment.scot/membership/', 'national', 30)
on conflict (title) do nothing;

-- ============================================================
-- DONE.
-- ============================================================
