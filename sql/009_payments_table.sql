-- 009_payments_table.sql
-- The payments ledger (Stripe subscription + promotion charges).
--
-- The original Buzz Guide database created this table out-of-band — its
-- CREATE TABLE was never committed as a migration, so a fresh install fails
-- at 010_payments_idempotency (which adds unique indexes ON payments).
-- Reconstructed here from the Stripe webhook handler
-- (src/app/api/stripe/webhook/route.ts) so the schema stands up cleanly.
--
-- NOTE: Stripe/payments is music-monetisation carried over from The Buzz
-- Guide and is slated for removal in the Buzz Kids strip (Stage 4). Kept for
-- now so the existing payment/promotion code runs against the new project.

create table if not exists public.payments (
  id                          uuid primary key default uuid_generate_v4(),
  venue_id                    uuid references public.venues(id)   on delete set null,
  owner_id                    uuid references public.profiles(id) on delete set null,
  event_id                    uuid references public.events(id)   on delete set null,
  type                        text not null,            -- 'subscription' | 'promotion'
  promotion_kind              text,                     -- spotlight | featured_pin | ...
  amount_cents                integer not null default 0,
  currency                    text not null default 'gbp',
  description                 text,
  stripe_checkout_session_id  text,
  stripe_invoice_id           text,
  stripe_payment_intent_id    text,
  created_at                  timestamptz not null default now()
);

create index if not exists payments_venue_idx on public.payments (venue_id);
create index if not exists payments_owner_idx on public.payments (owner_id);

-- RLS: only admins can read the ledger. Writes happen via the service-role
-- client in the Stripe webhook, which bypasses RLS.
alter table public.payments enable row level security;

drop policy if exists payments_admin_read on public.payments;
create policy payments_admin_read on public.payments for select
  using (public.is_admin());
