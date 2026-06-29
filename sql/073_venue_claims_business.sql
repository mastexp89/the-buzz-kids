-- ============================================================
-- The Buzz Kids: richer venue-claim details.
-- The claim flow now doubles as a business signup — capture the
-- business name, what kind of operator they are, and the two
-- declarations (authorised representative + accepted terms).
-- Run once in Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table venue_claims
  add column if not exists business_name  text,
  add column if not exists business_type  text
    check (business_type in ('individual', 'multiple', 'agency')),
  add column if not exists authorised_rep boolean not null default false,
  add column if not exists accepted_terms boolean not null default false;

-- ============================================================
-- DONE.
-- ============================================================
