-- Marks when the auto-enrichment cron last tried a venue, so it processes each
-- one once (and doesn't re-scan — and re-pay — venues Google has no data for).
-- Run this in the Supabase SQL editor.

alter table venues add column if not exists google_enrich_attempt timestamptz;
create index if not exists venues_enrich_attempt on venues (google_enrich_attempt);
