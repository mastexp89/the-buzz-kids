-- Coming-soon email capture. Simple store — email + timestamp.
-- No auth required to insert (public API route handles it server-side
-- via the service role, so RLS doesn't need a policy for inserts).
create table if not exists notify_signups (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now(),
  constraint notify_signups_email_unique unique (email)
);

-- Only admins can read the list.
alter table notify_signups enable row level security;
create policy "Admins can read notify_signups"
  on notify_signups for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
