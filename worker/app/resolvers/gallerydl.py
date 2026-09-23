"""gallery-dl resolver: image galleries / posts. Extraction only; returns direct image URLs."""

from __future__ import annotations

import asyncio
import time

from app.failures import FailureCode, ResolveError, classify
from app.models import MediaMetadata, MediaResult, MediaVariant
from app.resolvers.common import detect_platform

MAX_ITEMS = 40
MEDIA_KIND = {"jpg": "image", "jpeg": "image", "png": "image", "webp": "image", "gif": "image", "avif": "image",
              "mp4": "video", "webm": "video", "mov": "video"}


class GalleryDlResolver:
    id = "gallerydl"
    priority = 60

    def __init__(self, timeout: float = 25.0) -> None:
        self._timeout = timeout

    def score(self, url: str, platform: str) -> int:
        # yt-dlp handles video platforms better; gallery-dl is the fallback (and the choice for image hosts)
        return 50 if platform in ("Instagram", "Pinterest", "Reddit", "X", "Other") else 20

    def _extract(self, url: str) -> tuple[dict, list[MediaVariant]]:
        from gallery_dl import extractor
        from gallery_dl.extractor.message import Message

        ex = extractor.find(url)
        if ex is None:
            raise ResolveError(FailureCode.UNSUPPORTED, "No gallery-dl extractor for this URL")
        meta: dict = {}
        variants: list[MediaVariant] = []
        for msg in ex:
            if msg[0] == Message.Directory and not meta:
                meta = dict(msg[1])
            elif msg[0] == Message.Url:
                file_url, kw = msg[1], msg[2]
                ext = (kw.get("extension") or file_url.rsplit(".", 1)[-1].split("?")[0]).lower()
                kind = MEDIA_KIND.get(ext, "image")
                variants.append(MediaVariant(
                    id=f"{len(variants) + 1}", type=kind, label=f"{kind.title()} {len(variants) + 1} ({ext.upper()})",  # type: ignore[arg-type]
                    container=ext, url=file_url, has_video=kind == "video", has_audio=False,
                    width=kw.get("width"), height=kw.get("height"), filesize=kw.get("filesize"),
                ))
                if len(variants) >= MAX_ITEMS:
                    break
        return meta, variants

    async def resolve(self, url: str) -> MediaResult:
        try:
            meta, variants = await asyncio.wait_for(asyncio.to_thread(self._extract, url), timeout=self._timeout)
        except ResolveError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ResolveError(classify(exc), str(exc)[:300]) from exc
        if not variants:
            raise ResolveError(FailureCode.MEDIA_NOT_FOUND, "gallery-dl found no media")
        return MediaResult(
            resolver_id=self.id, resolved_at=time.time(), variants=variants,
            metadata=MediaMetadata(
                source_url=url, title=meta.get("title") or meta.get("description"), creator=meta.get("author") or meta.get("user"),
                platform=detect_platform(url), media_type=variants[0].type,
            ),
        )
