-- Messaging system: a single thread per non-admin user with The Buzz Guide admin team.
-- Each row is one message; user_id identifies the non-admin party in the thread.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  from_admin  boolean not null,
  body        text not null check (length(body) between 1 and 5000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

create index if not exists messages_unread_user_idx
  on public.messages (user_id) where read_at is null and from_admin = true;

create index if not exists messages_unread_admin_idx
  on public.messages (created_at desc) where read_at is null and from_admin = false;

alter table public.messages enable row level security;

-- The user can see their own thread
drop policy if exists "messages: user reads own thread" on public.messages;
create policy "messages: user reads own thread"
  on public.messages for select
  to authenticated
  using (user_id = auth.uid());

-- The user can post into their own thread, and only as a non-admin message
drop policy if exists "messages: user inserts own reply" on public.messages;
create policy "messages: user inserts own reply"
  on public.messages for insert
  to authenticated
  with check (user_id = auth.uid() and from_admin = false);

-- The user can mark admin-sent messages in their thread as read
drop policy if exists "messages: user marks read" on public.messages;
create policy "messages: user marks read"
  on public.messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins can do anything (mirrors how other admin policies work in this app)
drop policy if exists "messages: admin all" on public.messages;
create policy "messages: admin all"
  on public.messages for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
