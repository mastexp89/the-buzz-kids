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
