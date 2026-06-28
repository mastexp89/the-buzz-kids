-- 067_reviews_and_profiles.sql  (The Buzz Kids)
-- Parent-account features: profile photos, and moderated place-level reviews
-- with photos. Reviews attach to a VENUE (a soft play / farm / theatre that
-- recurs) and are hidden until an admin approves them.

-- 1. PROFILE AVATARS --------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

-- 2. REVIEWS ----------------------------------------------------------
create table if not exists public.reviews (
  id          uuid primary key default uuid_generate_v4(),
  venue_id    uuid not null references public.venues(id)   on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  title       text,
  body        text,
  status      text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reviews_venue_idx  on public.reviews (venue_id);
create index if not exists reviews_author_idx on public.reviews (author_id);
create index if not exists reviews_status_idx on public.reviews (status);
-- One review per author per place (they can edit it instead of stacking).
create unique index if not exists reviews_author_venue_uniq on public.reviews (author_id, venue_id);

create table if not exists public.review_images (
  id          uuid primary key default uuid_generate_v4(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  image_url   text not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists review_images_review_idx on public.review_images (review_id);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

-- Moderation guard: a non-admin can never set/change a review's status.
-- New reviews are forced to 'pending'; on edit, status is pinned to its
-- previous value. Admins (and the service-role client) bypass via is_admin().
create or replace function public.reviews_guard_status()
returns trigger as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending';
    else
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists reviews_guard_status_ins on public.reviews;
create trigger reviews_guard_status_ins before insert on public.reviews
  for each row execute function public.reviews_guard_status();
drop trigger if exists reviews_guard_status_upd on public.reviews;
create trigger reviews_guard_status_upd before update on public.reviews
  for each row execute function public.reviews_guard_status();

-- 3. RLS --------------------------------------------------------------
alter table public.reviews        enable row level security;
alter table public.review_images  enable row level security;

-- Reviews: world-readable when APPROVED; author sees their own (any status);
-- admins see all. Authors insert/edit/delete their own; the guard trigger
-- stops them touching status.
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews for select
  using (status = 'approved' or author_id = auth.uid() or public.is_admin());

drop policy if exists reviews_author_insert on public.reviews;
create policy reviews_author_insert on public.reviews for insert
  with check (author_id = auth.uid());

drop policy if exists reviews_author_update on public.reviews;
create policy reviews_author_update on public.reviews for update
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

drop policy if exists reviews_author_delete on public.reviews;
create policy reviews_author_delete on public.reviews for delete
  using (author_id = auth.uid() or public.is_admin());

-- Review images follow their parent review's visibility.
drop policy if exists review_images_read on public.review_images;
create policy review_images_read on public.review_images for select
  using (exists (
    select 1 from public.reviews r
    where r.id = review_images.review_id
      and (r.status = 'approved' or r.author_id = auth.uid() or public.is_admin())
  ));

drop policy if exists review_images_author_write on public.review_images;
create policy review_images_author_write on public.review_images for all
  using (exists (
    select 1 from public.reviews r
    where r.id = review_images.review_id
      and (r.author_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.reviews r
    where r.id = review_images.review_id
      and (r.author_id = auth.uid() or public.is_admin())
  ));

-- 4. STORAGE ----------------------------------------------------------
-- Allow authenticated users to upload to avatars/<uid>/* and reviews/<uid>/*
-- in the existing public `media` bucket. (Public read + owner update/delete
-- are already covered by the policies in storage.sql.)
drop policy if exists "Authed insert avatars and reviews" on storage.objects;
create policy "Authed insert avatars and reviews" on storage.objects for insert
  with check (
    bucket_id = 'media'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] in ('avatars', 'reviews')
    and (storage.foldername(name))[2] = auth.uid()::text
  );
