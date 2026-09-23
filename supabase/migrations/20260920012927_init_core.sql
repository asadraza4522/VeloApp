-- Velo core schema (docs/VELO_TECHNICAL_PLAN.md §4.2).
-- Rules: RLS on every table; policies `TO authenticated` AND ownership predicate; UPDATE policies carry
-- USING + WITH CHECK; nothing authorizes off user_metadata; monetization tables are client read-only
-- (writes go through service_role Edge Functions); functions that mutate them are service_role-only.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- Server clock owns updated_at (sync cursor).
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- User data (synced)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  distribution text check (distribution in ('full', 'lite')),
  push_token text,
  last_seen_at timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

create table public.media_sources (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  original_url text not null,
  canonical_url text not null,
  platform text not null default 'Other',
  platform_media_id text,
  creator_id text,
  creator_name text,
  title text,
  description text,
  thumbnail_url text,
  media_type text not null default 'unknown' check (media_type in ('video', 'audio', 'image', 'file', 'unknown')),
  duration_ms bigint,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  status text not null default 'saved' check (status in ('saved', 'resolved', 'unavailable', 'failed')),
  failure_code text,
  favorite boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index media_sources_user_canonical_uq on public.media_sources (user_id, canonical_url) where deleted_at is null;
create index media_sources_sync_idx on public.media_sources (user_id, updated_at, id);
create index media_sources_platform_idx on public.media_sources (user_id, platform);

create table public.source_urls (
  id uuid primary key,
  source_id uuid not null references public.media_sources (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null,
  kind text not null check (kind in ('original', 'canonical', 'redirect')),
  seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index source_urls_source_idx on public.source_urls (source_id);
create index source_urls_sync_idx on public.source_urls (user_id, updated_at, id);

-- No local_uri: files are device-only (PRD §62, plan §5).
create table public.downloads (
  id uuid primary key,
  source_id uuid not null references public.media_sources (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  variant jsonb,
  container text,
  resolution text,
  filename text,
  filesize bigint,
  status text not null default 'CREATED',
  failure_code text,
  resolver_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  file_deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index downloads_source_idx on public.downloads (source_id);
create index downloads_sync_idx on public.downloads (user_id, updated_at, id);

create table public.download_attempts (
  id uuid primary key,
  download_id uuid not null references public.downloads (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resolver_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  failure_code text,
  detail text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index download_attempts_download_idx on public.download_attempts (download_id);
create index download_attempts_sync_idx on public.download_attempts (user_id, updated_at, id);

create table public.organization_rules (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template text not null,
  filename_template text not null,
  scope text not null default 'default',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index organization_rules_sync_idx on public.organization_rules (user_id, updated_at, id);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- updated_at trigger on every synced table
do $$
declare t text;
begin
  foreach t in array array['media_sources', 'source_urls', 'downloads', 'download_attempts', 'organization_rules', 'settings']
  loop
    execute format('create trigger touch_updated_at before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Platform data (read-only to clients, written by the worker / migrations)
-- ---------------------------------------------------------------------------
create table public.resolvers (
  id text primary key,
  name text not null,
  priority int not null default 50,
  enabled boolean not null default true
);

create table public.resolver_capabilities (
  resolver_id text not null references public.resolvers (id) on delete cascade,
  platform text not null,       -- '*' = any
  media_type text not null,
  primary key (resolver_id, platform, media_type)
);

create table public.resolver_health (
  resolver_id text not null references public.resolvers (id) on delete cascade,
  platform text not null,
  success_rate real not null default 1 check (success_rate between 0 and 1),
  attempts int not null default 0,
  checked_at timestamptz not null default now(),
  primary key (resolver_id, platform)
);

create table public.feature_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Monetization (client read-only)
-- ---------------------------------------------------------------------------
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null,
  enabled boolean not null default true,
  source text not null check (source in ('subscription', 'rewarded_ad', 'promotion', 'admin')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, feature, source)
);
create index entitlements_user_idx on public.entitlements (user_id);

create table public.ad_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_network text not null,
  transaction_id text not null unique,   -- idempotency key from the ad network's SSV callback
  granted_seconds int not null,
  verified_at timestamptz not null default now()
);
create index ad_rewards_user_idx on public.ad_rewards (user_id);

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  rewarded_seconds int not null default 0,
  resolves int not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- New user → profile (auth trigger; SECURITY DEFINER lives in a non-exposed schema)
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.media_sources enable row level security;
alter table public.source_urls enable row level security;
alter table public.downloads enable row level security;
alter table public.download_attempts enable row level security;
alter table public.organization_rules enable row level security;
alter table public.settings enable row level security;
alter table public.resolvers enable row level security;
alter table public.resolver_capabilities enable row level security;
alter table public.resolver_health enable row level security;
alter table public.feature_flags enable row level security;
alter table public.entitlements enable row level security;
alter table public.ad_rewards enable row level security;
alter table public.usage_daily enable row level security;

-- profiles: own row, read + update (insert happens in the auth trigger)
create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- owner-CRUD tables. Sync uses tombstones (soft delete) so there is deliberately no DELETE policy on
-- synced tables; only devices can be hard-deleted by the owner.
do $$
declare t text;
begin
  foreach t in array array['devices', 'media_sources', 'source_urls', 'downloads', 'download_attempts', 'organization_rules', 'settings']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
create policy devices_delete on public.devices for delete to authenticated using ((select auth.uid()) = user_id);

-- children must belong to the caller's own parent (blocks attaching rows to someone else's source)
create policy source_urls_parent on public.source_urls as restrictive for insert to authenticated
  with check (exists (select 1 from public.media_sources s where s.id = source_id and s.user_id = (select auth.uid())));
create policy downloads_parent on public.downloads as restrictive for insert to authenticated
  with check (exists (select 1 from public.media_sources s where s.id = source_id and s.user_id = (select auth.uid())));
create policy download_attempts_parent on public.download_attempts as restrictive for insert to authenticated
  with check (exists (select 1 from public.downloads d where d.id = download_id and d.user_id = (select auth.uid())));

-- platform data: readable by signed-in users, writable only by service_role (bypasses RLS)
create policy resolvers_select on public.resolvers for select to authenticated using (true);
create policy resolver_capabilities_select on public.resolver_capabilities for select to authenticated using (true);
create policy resolver_health_select on public.resolver_health for select to authenticated using (true);
create policy feature_flags_select on public.feature_flags for select to authenticated using (true);

-- monetization: own rows, read-only
create policy entitlements_select on public.entitlements for select to authenticated using ((select auth.uid()) = user_id);
create policy ad_rewards_select on public.ad_rewards for select to authenticated using ((select auth.uid()) = user_id);
create policy usage_daily_select on public.usage_daily for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated only what the policies above allow
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.devices to authenticated;
grant select, insert, update on public.media_sources, public.source_urls, public.downloads,
  public.download_attempts, public.organization_rules, public.settings to authenticated;
grant select on public.resolvers, public.resolver_capabilities, public.resolver_health, public.feature_flags,
  public.entitlements, public.ad_rewards, public.usage_daily to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only functions (called by Edge Functions with the service role)
-- ---------------------------------------------------------------------------

-- Atomic per-day resolve quota. Returns the new count, or null when the limit is already reached.
create function public.consume_resolve(p_user uuid, p_limit int) returns int
language sql set search_path = '' as $$
  insert into public.usage_daily as u (user_id, day, resolves)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set resolves = u.resolves + 1
    where u.resolves < p_limit
  returning u.resolves;
$$;

-- Verified rewarded ad → +1 h premium, stacking on the remaining time (PRD §52). Idempotent per
-- transaction id, capped per day. Returns the new premium_until, or null if capped/duplicate.
create function public.grant_rewarded_hour(p_user uuid, p_txn text, p_network text, p_cap_hours int)
returns timestamptz language plpgsql set search_path = '' as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_until timestamptz;
begin
  -- serialize per user so two simultaneous callbacks cannot both slip under the cap
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  if exists (select 1 from public.ad_rewards where transaction_id = p_txn) then
    return null;
  end if;
  if coalesce((select rewarded_seconds from public.usage_daily where user_id = p_user and day = v_day), 0) + 3600 > p_cap_hours * 3600 then
    return null;
  end if;

  insert into public.ad_rewards (user_id, ad_network, transaction_id, granted_seconds) values (p_user, p_network, p_txn, 3600);
  insert into public.usage_daily as u (user_id, day, rewarded_seconds) values (p_user, v_day, 3600)
    on conflict (user_id, day) do update set rewarded_seconds = u.rewarded_seconds + 3600;

  insert into public.entitlements as e (user_id, feature, source, expires_at)
    values (p_user, 'premium', 'rewarded_ad', now() + interval '1 hour')
    on conflict (user_id, feature, source) do update
      set expires_at = greatest(now(), coalesce(e.expires_at, now())) + interval '1 hour', enabled = true
    returning expires_at into v_until;
  return v_until;
end $$;

revoke execute on function public.consume_resolve(uuid, int) from public, anon, authenticated;
revoke execute on function public.grant_rewarded_hour(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.consume_resolve(uuid, int) to service_role;
grant execute on function public.grant_rewarded_hour(uuid, text, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
insert into public.resolvers (id, name, priority) values
  ('direct', 'Direct file', 100),
  ('ytdlp', 'yt-dlp', 80),
  ('gallerydl', 'gallery-dl', 60),
  ('oembed', 'oEmbed (metadata only)', 10);

insert into public.resolver_capabilities (resolver_id, platform, media_type) values
  ('direct', '*', 'video'), ('direct', '*', 'audio'), ('direct', '*', 'image'), ('direct', '*', 'file'),
  ('ytdlp', '*', 'video'), ('ytdlp', '*', 'audio'),
  ('gallerydl', '*', 'image'),
  ('oembed', 'YouTube', 'video'), ('oembed', 'Vimeo', 'video'), ('oembed', 'SoundCloud', 'audio');

insert into public.feature_flags (key, value) values
  ('rewarded_hours_per_day', '4'),
  ('resolves_per_day_free', '200'),
  ('resolves_per_day_premium', '1000'),
  ('max_concurrent_downloads', '3');
