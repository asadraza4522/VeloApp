"""Metadata-only fallback via the platform's own oEmbed endpoint. Never produces variants."""

from __future__ import annotations

import time
from urllib.parse import urlparse

import httpx

from app.failures import FailureCode, ResolveError
from app.models import MediaMetadata, MediaResult
from app.security import safe_request

ENDPOINTS = [
    ("youtube.com", "https://www.youtube.com/oembed", "video"),
    ("youtu.be", "https://www.youtube.com/oembed", "video"),
    ("vimeo.com", "https://vimeo.com/api/oembed.json", "video"),
    ("soundcloud.com", "https://soundcloud.com/oembed", "audio"),
]


class OEmbedResolver:
    id = "oembed"
    priority = 10

    def __init__(self, timeout: float = 10.0, client: httpx.AsyncClient | None = None) -> None:
        self._timeout = timeout
        self._client = client

    def _endpoint(self, url: str):
        host = (urlparse(url).hostname or "").lower()
        return next((e for e in ENDPOINTS if host == e[0] or host.endswith("." + e[0])), None)

    def score(self, url: str, platform: str) -> int:
        return 20 if self._endpoint(url) else 0

    async def resolve(self, url: str) -> MediaResult:
        endpoint = self._endpoint(url)
        if not endpoint:
            raise ResolveError(FailureCode.UNSUPPORTED, "No oEmbed endpoint for this host")
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            resp = await safe_request(client, "GET", endpoint[1], params={"url": url, "format": "json"})
        finally:
            if self._client is None:
                await client.aclose()
        if resp.status_code in (401, 403):
            raise ResolveError(FailureCode.PRIVATE, f"oEmbed HTTP {resp.status_code}")
        if resp.status_code == 404:
            raise ResolveError(FailureCode.MEDIA_NOT_FOUND, "oEmbed HTTP 404")
        if resp.status_code >= 400:
            raise ResolveError(FailureCode.SERVER_ERROR, f"oEmbed HTTP {resp.status_code}")
        data = resp.json()
        if not data.get("title"):
            raise ResolveError(FailureCode.PROVIDER_CHANGED, "oEmbed returned no title")
        return MediaResult(
            resolver_id=self.id, resolved_at=time.time(), degraded=True, variants=[],
            metadata=MediaMetadata(
                source_url=url, title=data["title"], creator=data.get("author_name"),
                platform=data.get("provider_name") or "Web", thumbnail_url=data.get("thumbnail_url"),
                media_type=endpoint[2],  # type: ignore[arg-type]
            ),
        )
