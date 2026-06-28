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
