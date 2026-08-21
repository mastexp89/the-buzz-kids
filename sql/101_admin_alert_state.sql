-- Throttle state for one-off admin alerts (Telegram).
--
-- Some failures affect every AI call at once — an exhausted Anthropic credit
-- balance takes down poster reading, the FB scrape, and the site-ingest cron
-- simultaneously. Without a throttle, a single Friday sweep would fire the
-- same alert 300+ times (10 venues x 36 cron ticks).
--
-- claim_admin_alert() is the atomic gate: the first caller inside the cooldown
-- window gets true and sends; everyone else gets false and stays quiet. The
-- upsert + conditional WHERE means concurrent lambdas can't both win.

create table if not exists admin_alert_state (
  key           text primary key,
  last_sent_at  timestamptz not null default now()
);

-- Service-role only. No policies = no anon/authenticated access; the service
-- key bypasses RLS, which is the only thing that touches this table.
alter table admin_alert_state enable row level security;

create or replace function claim_admin_alert(
  p_key text,
  p_cooldown_minutes int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  insert into admin_alert_state (key, last_sent_at)
  values (p_key, now())
  on conflict (key) do update
    set last_sent_at = now()
    -- Only "win" if the last alert is older than the cooldown. If it isn't,
    -- no row is updated and RETURNING yields nothing -> claimed stays null.
    where admin_alert_state.last_sent_at < now() - make_interval(mins => p_cooldown_minutes)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function claim_admin_alert(text, int) from public, anon, authenticated;
