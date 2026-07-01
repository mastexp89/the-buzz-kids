-- ============================================================
-- 086: edit_suggestions — public "Suggest an edit / tell us about
-- your place" submissions. Covers three kinds:
--   - venue      : a correction to an existing place
--   - event      : a correction to a What's On item
--   - new_place  : a business asking to be listed (replaces the old
--                  owner account signup for "List your activity")
--
-- Replaces the thin inline venues.reports flag (counter + latest note)
-- with a real reviewable queue that keeps every submission, its free
-- text, optional contact and an "I run this" flag. The venues counter
-- is still bumped for venue targets so existing admin badges keep
-- working — this table is the durable record.
-- ============================================================

create table if not exists public.edit_suggestions (
  id uuid primary key default gen_random_uuid(),

  target_type text not null check (target_type in ('venue', 'event', 'new_place')),
  target_id uuid,             -- the venue/event; null for new_place
  target_name text,           -- denormalised label for the admin list
  city_slug text,             -- helps admin jump to the right area

  reason text,                -- short category (Closed / Wrong details / …)
  details text,               -- free-text correction / message
  contact_name text,
  contact_email text,
  is_owner boolean not null default false,

  status text not null default 'new'
    check (status in ('new', 'reviewed', 'done')),

  created_at timestamptz not null default now()
);

create index if not exists edit_suggestions_status_idx
  on public.edit_suggestions (status, created_at desc);

alter table public.edit_suggestions enable row level security;

-- No public read. Submissions are written server-side via the service
-- client (bypasses RLS), so anonymous visitors need no insert policy.
-- Staff read the queue.
drop policy if exists "edit_suggestions: staff read" on public.edit_suggestions;
create policy "edit_suggestions: staff read"
  on public.edit_suggestions for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'editor')
    )
  );

notify pgrst, 'reload schema';
