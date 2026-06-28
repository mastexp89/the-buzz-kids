-- =====================================================================
-- The Buzz Guide — Supabase Storage buckets & policies
-- Run this AFTER schema.sql.
-- =====================================================================

-- Create the public bucket for venue + event images.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- Anyone can read media (it's a public bucket but be explicit).
drop policy if exists "Public read media" on storage.objects;
create policy "Public read media" on storage.objects for select
  using (bucket_id = 'media');

-- Authenticated users can upload to /venues/<their-uid>/* and /events/<their-uid>/*
drop policy if exists "Authed insert media" on storage.objects;
create policy "Authed insert media" on storage.objects for insert
  with check (
    bucket_id = 'media'
    and auth.role() = 'authenticated'
    and (
      (storage.foldername(name))[1] = 'venues'
      or (storage.foldername(name))[1] = 'events'
    )
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Authed update own media" on storage.objects;
create policy "Authed update own media" on storage.objects for update
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Authed delete own media" on storage.objects;
create policy "Authed delete own media" on storage.objects for delete
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
