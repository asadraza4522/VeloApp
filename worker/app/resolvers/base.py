from __future__ import annotations

from typing import Protocol

from app.models import MediaResult


class Resolver(Protocol):
    id: str
    priority: int  # tie-breaker / base weight (mirrors the `resolvers` table)

    def score(self, url: str, platform: str) -> int:
        """Confidence 0-100 that this resolver can handle the URL; 0 = not applicable."""

    async def resolve(self, url: str) -> MediaResult: ...
