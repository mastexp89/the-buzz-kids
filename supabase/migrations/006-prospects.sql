-- Outreach tracker: list of bars/pubs/clubs/venues we want to onboard.
-- Admins-only.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'bar',
  -- 'bar' | 'pub' | 'club' | 'venue' | 'hotel' | 'theatre' | 'restaurant' | 'other'
  city_id uuid references public.cities(id) on delete set null,
  address text,
  postcode text,
  phone text,
  email text,
  website text,
  instagram text,
  facebook text,
  notes text,
  status text not null default 'not_contacted',
  -- 'not_contacted' | 'contacted' | 'interested' | 'onboarded' | 'rejected'
  last_contacted_at timestamptz,
  last_contacted_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prospects_status_idx on public.prospects(status);
create index if not exists prospects_city_idx on public.prospects(city_id);
create index if not exists prospects_assigned_idx on public.prospects(assigned_to);

-- Maintain updated_at automatically
create or replace function public.set_updated_at_now()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
before update on public.prospects
for each row execute function public.set_updated_at_now();

-- RLS: admins only
alter table public.prospects enable row level security;

drop policy if exists "Admins read prospects" on public.prospects;
create policy "Admins read prospects" on public.prospects
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "Admins write prospects" on public.prospects;
create policy "Admins write prospects" on public.prospects
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
