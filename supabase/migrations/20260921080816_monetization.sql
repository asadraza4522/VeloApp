-- Monetization (docs/VELO_TECHNICAL_PLAN.md §9). Clients stay read-only; the two Edge Functions write through
-- service-role-only functions: `grant_rewarded_hour` (init_core) for verified ads, `apply_subscription` for RevenueCat.

-- Out-of-order webhook protection: an event older than the one already applied is ignored.
alter table public.entitlements add column source_event_ms bigint;

create function public.apply_subscription(p_user uuid, p_enabled boolean, p_expires timestamptz, p_event_ms bigint)
returns boolean language plpgsql set search_path = '' as $$
declare v_applied boolean;
begin
  insert into public.entitlements as e (user_id, feature, source, enabled, expires_at, source_event_ms)
  values (p_user, 'premium', 'subscription', p_enabled, p_expires, p_event_ms)
  on conflict (user_id, feature, source) do update
    set enabled = excluded.enabled, expires_at = excluded.expires_at, source_event_ms = excluded.source_event_ms
    where e.source_event_ms is null or e.source_event_ms <= excluded.source_event_ms
  returning true into v_applied;
  return coalesce(v_applied, false);
end $$;

revoke execute on function public.apply_subscription(uuid, boolean, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.apply_subscription(uuid, boolean, timestamptz, bigint) to service_role;

-- The app learns about a new entitlement quickly (a Realtime hint → refresh); it never trusts the client for this.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.entitlements;
  end if;
end $$;
