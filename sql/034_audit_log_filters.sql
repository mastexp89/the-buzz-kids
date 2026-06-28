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
