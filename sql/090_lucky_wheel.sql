-- Lucky spin-the-wheel: email-capture prize wheel.
-- Everything is read/written server-side with the service role, so these
-- tables have RLS on with NO public policies (locked to service role).
-- Run this whole file in the Supabase SQL editor.

-- 1. Single-row config for the current campaign ------------------------------
create table if not exists wheel_config (
  id            int primary key default 1,
  grand_prize   text not null default 'a family pass to the circus',
  grand_detail  text default 'Spin once a day for a chance to win — every spin can win an instant prize or bag you another entry into the draw.',
  closes_on     date,
  active        boolean not null default false,
  updated_at    timestamptz not null default now(),
  constraint wheel_config_singleton check (id = 1)
);

insert into wheel_config (id) values (1) on conflict (id) do nothing;

-- 2. The wheel slices (prizes) -----------------------------------------------
-- kind 'entry' = a draw entry (fulfilled by the monthly draw)
-- kind 'real'  = an instant prize (fulfilled by hand from the admin list)
-- slots        = how many of the 8-ish slices this prize occupies (its odds)
create table if not exists wheel_prizes (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  kind       text not null check (kind in ('entry', 'real')),
  slots      int  not null default 1 check (slots >= 1),
  color      text not null default '#9B4DFF',
  sort       int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed the five prizes Dylan chose (only if the table is empty).
insert into wheel_prizes (label, kind, slots, color, sort)
select * from (values
  ('Circus draw entry',        'entry', 3, '#9B4DFF', 1),
  ('£5 Just Eat voucher',      'real',  1, '#F9A11B', 2),
  ('Megan''s Sports Bar entry','entry', 2, '#EC1E8C', 3),
  ('Soft play passes x2',      'real',  1, '#1FA9E0', 4),
  ('Free swim x2',             'real',  1, '#6FA713', 5)
) as v(label, kind, slots, color, sort)
where not exists (select 1 from wheel_prizes);

-- 3. Every spin --------------------------------------------------------------
-- One spin per email per day (unique constraint) + one per IP per day
-- (enforced in the server action against ip_hash).
create table if not exists wheel_spins (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  ip_hash     text,
  prize_id    uuid references wheel_prizes(id) on delete set null,
  prize_label text,
  prize_kind  text,
  spun_on     date not null,
  fulfilled   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (email, spun_on)
);

create index if not exists wheel_spins_ip_day  on wheel_spins (ip_hash, spun_on);
create index if not exists wheel_spins_label    on wheel_spins (prize_label);
create index if not exists wheel_spins_email    on wheel_spins (email);

-- 4. Double opt-in tracking on the existing mailing list ---------------------
alter table notify_signups add column if not exists confirmed     boolean not null default false;
alter table notify_signups add column if not exists confirm_token uuid;
alter table notify_signups add column if not exists confirmed_at  timestamptz;
create index if not exists notify_signups_token on notify_signups (confirm_token);

-- 5. Lock the new tables to the service role ---------------------------------
alter table wheel_config  enable row level security;
alter table wheel_prizes  enable row level security;
alter table wheel_spins   enable row level security;
