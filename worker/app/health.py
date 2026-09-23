"""Rolling per-(resolver, platform) success rate. Ranks resolvers and (optionally) syncs to Supabase."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx

log = logging.getLogger("velo.health")
ALPHA = 0.2  # weight of the newest observation


class HealthTracker:
    def __init__(self) -> None:
        self._rate: dict[tuple[str, str], float] = {}
        self._attempts: dict[tuple[str, str], int] = {}
        self._dirty: set[tuple[str, str]] = set()

    def record(self, resolver_id: str, platform: str, ok: bool) -> None:
        key = (resolver_id, platform)
        prev = self._rate.get(key, 1.0)
        self._rate[key] = prev * (1 - ALPHA) + (1.0 if ok else 0.0) * ALPHA
        self._attempts[key] = self._attempts.get(key, 0) + 1
        self._dirty.add(key)

    def rate(self, resolver_id: str, platform: str) -> float:
        return self._rate.get((resolver_id, platform), 1.0)

    def drain_dirty(self) -> list[dict]:
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            {"resolver_id": r, "platform": p, "success_rate": round(self._rate[(r, p)], 4),
             "attempts": self._attempts[(r, p)], "checked_at": now}
            for (r, p) in self._dirty
        ]
        self._dirty.clear()
        return rows


class SupabaseHealthSink:
    """Upserts resolver_health through PostgREST with the service key (server-side only)."""

    def __init__(self, url: str, service_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._endpoint = f"{url.rstrip('/')}/rest/v1/resolver_health"
        self._headers = {"apikey": service_key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
        if not service_key.startswith("sb_"):  # new-style secret keys (sb_secret_…) are not JWTs and go in `apikey` only
            self._headers["Authorization"] = f"Bearer {service_key}"
        self._client = client or httpx.AsyncClient(timeout=10)

    async def flush(self, tracker: HealthTracker) -> int:
        rows = tracker.drain_dirty()
        if not rows:
            return 0
        try:
            resp = await self._client.post(self._endpoint, json=rows, headers=self._headers, params={"on_conflict": "resolver_id,platform"})
            resp.raise_for_status()
        except httpx.HTTPError as exc:  # health is best-effort; never break resolving
            log.warning("resolver_health flush failed: %s", exc)
            return 0
        return len(rows)


def sink_from_env() -> SupabaseHealthSink | None:
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return SupabaseHealthSink(url, key) if url and key else None
