-- Sync (docs/VELO_TECHNICAL_PLAN.md §5): last-write-wins by the *client's* edit time, plus Realtime hints.
--
-- `updated_at` stays server-owned (it is the pull cursor). `client_updated_at` is the device's edit time and
-- decides conflicts: an older write can never overwrite a newer one, whatever order the pushes arrive in.

create or replace function public.lww_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return old; -- stale write: keep the newer row untouched
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['media_sources', 'source_urls', 'downloads', 'download_attempts', 'organization_rules', 'settings']
  loop
    execute format('alter table public.%I add column client_updated_at timestamptz not null default now()', t);
    -- Named "zz_…" so it fires AFTER touch_updated_at (triggers run alphabetically): returning OLD then discards
    -- the whole change, including the updated_at bump, so ignored writes do not echo back to other devices.
    execute format('create trigger zz_lww_guard before update on public.%I for each row execute function public.lww_guard()', t);
  end loop;
end $$;

-- Realtime is only a *hint* to pull now (the client never relies on delivery). Guarded so the migration also
-- applies on plain Postgres (tests) where the publication does not exist.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['media_sources', 'source_urls', 'downloads', 'download_attempts', 'organization_rules', 'settings']
    loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
