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
