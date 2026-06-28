-- ============================================================
-- 031: Sponsor counter RPC helpers.
--
-- These were added late to sql/029 after the table itself shipped,
-- so this migration just ensures they exist on databases that ran
-- 029 before they were added.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create or replace function public.increment_sponsor_impression(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set impression_count = impression_count + 1
  where id = sponsor_id;
$$;

create or replace function public.increment_sponsor_click(sponsor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sponsors
  set click_count = click_count + 1
  where id = sponsor_id;
$$;

-- Service role only. Block public / authenticated execution so a regular
-- user can't manually inflate counters by calling the RPC themselves.
revoke all on function public.increment_sponsor_impression(uuid) from public, anon, authenticated;
revoke all on function public.increment_sponsor_click(uuid) from public, anon, authenticated;
grant execute on function public.increment_sponsor_impression(uuid) to service_role;
grant execute on function public.increment_sponsor_click(uuid) to service_role;

notify pgrst, 'reload schema';
