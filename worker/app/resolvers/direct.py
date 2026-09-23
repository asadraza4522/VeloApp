"""Direct file URLs: metadata from headers, the URL itself is the download."""

from __future__ import annotations

import os
import time
from urllib.parse import unquote, urlparse

import httpx

from app.failures import FailureCode, ResolveError
from app.models import MediaMetadata, MediaResult, MediaVariant
from app.policy import MEDIA_EXTENSIONS, extension, is_direct_file
from app.security import safe_request

UA = os.getenv("RESOLVER_USER_AGENT", "Mozilla/5.0 (compatible; VeloResolver/1.0)")


def _kind_from(ext: str, content_type: str) -> str | None:
    ct = content_type.split(";")[0].strip().lower()
    for kind in ("video", "audio", "image"):
        if ct.startswith(kind + "/") or ext in MEDIA_EXTENSIONS[kind]:
            return kind
    return None


class DirectResolver:
    id = "direct"
    priority = 100

    def __init__(self, timeout: float = 15.0, client: httpx.AsyncClient | None = None) -> None:
        self._timeout = timeout
        self._client = client

    def score(self, url: str, platform: str) -> int:
        if is_direct_file(url):
            return 100
        return 5 if platform == "Other" else 0  # unknown host: worth one HEAD as a last resort

    async def resolve(self, url: str) -> MediaResult:
        client = self._client or httpx.AsyncClient(timeout=self._timeout, headers={"User-Agent": UA})
        try:
            resp = await safe_request(client, "HEAD", url)
            if resp.status_code in (400, 403, 405, 501):  # some servers reject HEAD
                resp = await safe_request(client, "GET", url, headers={"Range": "bytes=0-0"})
        finally:
            if self._client is None:
                await client.aclose()
        if resp.status_code in (401, 403):
            raise ResolveError(FailureCode.AUTH_REQUIRED, f"HTTP {resp.status_code}")
        if resp.status_code == 404:
            raise ResolveError(FailureCode.MEDIA_NOT_FOUND, "HTTP 404")
        if resp.status_code == 429:
            raise ResolveError(FailureCode.RATE_LIMITED, "HTTP 429")
        if resp.status_code >= 400:
            raise ResolveError(FailureCode.SERVER_ERROR, f"HTTP {resp.status_code}")

        ext = extension(url)
        kind = _kind_from(ext, resp.headers.get("content-type", ""))
        if kind is None:
            raise ResolveError(FailureCode.UNSUPPORTED, "Not a direct media file")

        cr = resp.headers.get("content-range", "")  # "bytes 0-0/12345" after a ranged GET
        length = cr.rsplit("/", 1)[-1] if "/" in cr else resp.headers.get("content-length")
        size = int(length) if length and length.isdigit() else None
        parsed = urlparse(url)
        filename = unquote(parsed.path.rsplit("/", 1)[-1]) or "file"
        container = (ext or "." + resp.headers.get("content-type", "/bin").split("/")[-1].split(";")[0]).lstrip(".")
        variant = MediaVariant(
            id="original", type=kind, label=f"Original {container.upper()}", container=container, url=url,
            has_video=kind == "video", has_audio=kind in ("video", "audio"), filesize=size, ip_bound=False,
        )
        return MediaResult(
            resolver_id=self.id, resolved_at=time.time(),
            metadata=MediaMetadata(
                source_url=url, title=filename, creator=parsed.hostname, platform=parsed.hostname or "Web",
                thumbnail_url=url if kind == "image" else None, media_type=kind,  # type: ignore[arg-type]
            ),
            variants=[variant],
        )
