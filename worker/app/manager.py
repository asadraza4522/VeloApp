"""Resolver Manager (PRD §20-23): pick the best healthy resolver, fall back only when the failure allows it."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from app import policy
from app.failures import FALLBACK_ALLOWED, FailureCode, ResolveError, classify
from app.health import HealthTracker
from app.models import MediaResult
from app.resolvers.base import Resolver
from app.resolvers.common import detect_platform
from app.security import validate_url

log = logging.getLogger("velo.manager")


@dataclass
class Attempt:
    resolver_id: str
    ok: bool
    code: FailureCode | None = None
    ms: int = 0


class ResolveFailed(ResolveError):
    def __init__(self, code: FailureCode, message: str, attempts: list[Attempt]) -> None:
        super().__init__(code, message)
        self.attempts = attempts


class ResolverManager:
    def __init__(self, resolvers: list[Resolver], health: HealthTracker | None = None, max_concurrency: int = 8) -> None:
        self._resolvers = resolvers
        self.health = health or HealthTracker()
        self._sem = asyncio.Semaphore(max_concurrency)

    def _ranked(self, url: str, platform: str) -> list[Resolver]:
        scored = []
        for r in self._resolvers:
            base = r.score(url, platform)
            if base > 0:
                # healthy resolvers first; a failing one is demoted but never fully excluded
                scored.append((base * (0.3 + 0.7 * self.health.rate(r.id, platform)), r.priority, r))
        scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
        return [r for _, _, r in scored]

    async def resolve(self, url: str, *, distribution: str = "full") -> MediaResult:
        url = await validate_url(url)
        policy.enforce(distribution, url)
        platform = detect_platform(url)
        candidates = self._ranked(url, platform)
        if not candidates:
            raise ResolveFailed(FailureCode.UNSUPPORTED, "No resolver supports this URL", [])

        attempts: list[Attempt] = []
        last: ResolveError | None = None
        async with self._sem:
            for resolver in candidates:
                t0 = time.monotonic()
                try:
                    result = await resolver.resolve(url)
                except Exception as exc:  # noqa: BLE001
                    code = classify(exc)
                    last = exc if isinstance(exc, ResolveError) else ResolveError(code, str(exc)[:300])
                    attempts.append(Attempt(resolver.id, False, code, int((time.monotonic() - t0) * 1000)))
                    # only resolver-side problems count against a resolver's health
                    if code in FALLBACK_ALLOWED:
                        self.health.record(resolver.id, platform, False)
                    log.info("resolver=%s platform=%s failed code=%s", resolver.id, platform, code)
                    if code not in FALLBACK_ALLOWED:
                        break  # auth / DRM / private / not found / rate-limited: never work around
                    continue
                self.health.record(resolver.id, platform, True)
                attempts.append(Attempt(resolver.id, True, None, int((time.monotonic() - t0) * 1000)))
                return result
        assert last is not None
        raise ResolveFailed(last.code, last.message, attempts)
