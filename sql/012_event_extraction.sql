-- ============================================================
-- The Buzz Guide: AI event extraction pipeline.
-- Adds source-tracking columns to events so we know where each
-- auto-extracted gig came from (FB post, venue website, manual upload),
-- the model's confidence, and the original post/page so we can re-run
-- extraction with an improved prompt.
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table events
  add column if not exists auto_imported_from text
    check (auto_imported_from in ('manual_upload', 'facebook', 'instagram', 'website', 'email')),
  add column if not exists auto_import_confidence numeric(3, 2),
  add column if not exists auto_import_source_url text,
  add column if not exists auto_import_evidence text,
  add column if not exists auto_import_image_url text,
  add column if not exists auto_import_post_text text,
  add column if not exists auto_import_batch_id uuid;

create index if not exists events_auto_imported_idx
  on events (auto_imported_from)
  where auto_imported_from is not null;

-- Batch table: keep raw payloads so we can re-extract later if the prompt improves
create table if not exists extraction_batches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade not null,
  source text not null
    check (source in ('manual_upload', 'facebook', 'instagram', 'website', 'email')),
  source_url text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz default now(),
  text_content text,
  image_urls text[],
  raw_response jsonb,
  events_created integer default 0,
  status text default 'processed'
    check (status in ('pending', 'processed', 'failed')),
  error_message text
);

create index if not exists extraction_batches_venue_idx on extraction_batches (venue_id, uploaded_at desc);

alter table extraction_batches enable row level security;

drop policy if exists "extraction_batches: admin all" on extraction_batches;
create policy "extraction_batches: admin all"
  on extraction_batches for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- DONE.
-- ============================================================
