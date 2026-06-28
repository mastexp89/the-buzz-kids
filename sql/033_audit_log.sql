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
