-- 088: unsubscribe list for marketing / newsletter sends. Any email in here is
-- skipped by broadcasts. Transactional emails (welcome, claim, submission
-- notices) ignore this list — only bulk sends check it.
create table if not exists public.email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.email_unsubscribes enable row level security;
-- Writes/reads are server-side via the service role (unsubscribe route +
-- broadcast sender). No public policy needed.

notify pgrst, 'reload schema';
