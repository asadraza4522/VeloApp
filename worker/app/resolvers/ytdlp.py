"""yt-dlp resolver: extraction only (`skip_download`), returns direct URLs for the phone to fetch."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.failures import ResolveError, classify
from app.models import MediaMetadata, MediaResult, MediaVariant
from app.resolvers.common import detect_platform

PLATFORM_KEYS = {
    "youtube": "YouTube", "instagram": "Instagram", "tiktok": "TikTok", "facebook": "Facebook", "twitter": "X",
    "reddit": "Reddit", "pinterest": "Pinterest", "vimeo": "Vimeo", "soundcloud": "SoundCloud",
    "dailymotion": "Dailymotion", "twitch": "Twitch", "archiveorg": "Internet Archive",
}
KEEP_HEADERS = ("User-Agent", "Referer", "Origin", "Accept", "Accept-Language")
MAX_VARIANTS = 40


def _none(v: Any) -> bool:
    return v is None or v == "none"


def _headers(fmt: dict, info: dict) -> dict[str, str]:
    merged = {**(info.get("http_headers") or {}), **(fmt.get("http_headers") or {})}
    return {k: v for k, v in merged.items() if k in KEEP_HEADERS}


def _protocol(fmt: dict) -> str | None:
    p = fmt.get("protocol") or ""
    if p in ("https", "http"):
        return "https"
    if p.startswith("m3u8"):
        return "hls"
    if p == "http_dash_segments":
        return "dash"
    return None  # mhtml, rtmp, ftp… not downloadable by the phone


def _expiry(url: str) -> float | None:
    vals = parse_qs(urlparse(url).query).get("expire")
    return float(vals[0]) if vals and vals[0].isdigit() else None


def _ip_bound(url: str) -> bool | None:
    u = urlparse(url)
    return True if "ip=" in u.query or "/ip/" in u.path else None


def _to_variant(fmt: dict, info: dict) -> MediaVariant | None:
    url = fmt.get("url")
    proto = _protocol(fmt)
    if not url or not proto or fmt.get("has_drm") or fmt.get("ext") == "mhtml" or fmt.get("format_note") == "storyboard":
        return None
    v, a = fmt.get("vcodec"), fmt.get("acodec")
    has_video = v != "none" and (v is not None or bool(fmt.get("height")))
    has_audio = a != "none"
    if not has_video and not has_audio:
        return None
    ext = fmt.get("ext") or "mp4"
    height = fmt.get("height")
    if has_video:
        label = f"{height}p {ext.upper()}" if height else ext.upper()
        if not has_audio:
            label += " (video only)"
    else:
        abr = fmt.get("abr")
        label = f"{round(abr)}k {ext.upper()}" if abr else f"Audio {ext.upper()}"
    return MediaVariant(
        id=str(fmt.get("format_id") or f"{ext}-{height}"), type="video" if has_video else "audio", label=label,
        container=ext, url=url, headers=_headers(fmt, info), protocol=proto,  # type: ignore[arg-type]
        has_video=has_video, has_audio=has_audio,
        video_codec=None if _none(v) else v, audio_codec=None if _none(a) else a,
        width=fmt.get("width"), height=height, fps=fmt.get("fps"),
        bitrate=int(fmt["tbr"] * 1000) if fmt.get("tbr") else None,
        filesize=fmt.get("filesize") or fmt.get("filesize_approx"), ip_bound=_ip_bound(url),
    )


def _rank(v: MediaVariant) -> tuple:
    # Prefer widely muxable/playable (mp4/avc/aac), then bitrate.
    return (v.container in ("mp4", "m4a"), (v.video_codec or "").startswith("avc"), (v.audio_codec or "").startswith("mp4a"), v.bitrate or 0)


def select_variants(info: dict) -> list[MediaVariant]:
    """Keep the useful ones: best progressive + best video-only per height, and the top audio-only tracks."""
    all_v = [v for f in info.get("formats") or [] if (v := _to_variant(f, info))]
    picked: dict[tuple, MediaVariant] = {}
    for v in all_v:
        if v.type == "video":
            key = ("video", v.height, v.has_audio, v.protocol)
            if key not in picked or _rank(v) > _rank(picked[key]):
                picked[key] = v
    videos = sorted((p for k, p in picked.items() if k[0] == "video"), key=lambda v: (-(v.height or 0), not v.has_audio))
    audios = sorted((v for v in all_v if v.type == "audio"), key=_rank, reverse=True)[:3]
    return (videos + audios)[:MAX_VARIANTS]


def _published(info: dict) -> str | None:
    if ts := info.get("timestamp") or info.get("release_timestamp"):
        return datetime.fromtimestamp(ts, timezone.utc).isoformat()
    if d := info.get("upload_date"):
        try:
            return datetime.strptime(d, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None
    return None


def normalize(info: dict, url: str) -> MediaResult:
    variants = select_variants(info)
    key = (info.get("extractor_key") or info.get("extractor") or "").lower().split(":")[0]
    platform = PLATFORM_KEYS.get(key) or (detect_platform(url) if key in ("generic", "") else key.capitalize())
    thumb = info.get("thumbnail") or ((info.get("thumbnails") or [{}])[-1].get("url"))
    kinds = {v.type for v in variants}
    now = time.time()
    expiries = [e for v in variants if (e := _expiry(v.url))]
    return MediaResult(
        resolver_id="ytdlp", resolved_at=now, expires_at=min(expiries) if expiries else None, variants=variants,
        metadata=MediaMetadata(
            source_url=url, title=info.get("title"), description=(info.get("description") or "")[:2000] or None,
            creator=info.get("uploader") or info.get("channel"), creator_id=info.get("channel_id") or info.get("uploader_id"),
            platform=platform, platform_media_id=str(info["id"]) if info.get("id") else None, thumbnail_url=thumb,
            published_at=_published(info), duration=info.get("duration"),
            media_type="video" if "video" in kinds else "audio" if "audio" in kinds else "unknown",
        ),
    )


class YtDlpResolver:
    id = "ytdlp"
    priority = 80

    def __init__(self, timeout: float = 25.0) -> None:
        self._timeout = timeout

    def score(self, url: str, platform: str) -> int:
        return 80 if platform != "Other" else 40

    def _extract(self, url: str) -> dict:
        import yt_dlp

        opts = {
            "quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
            "socket_timeout": min(self._timeout, 15), "extract_flat": False,
        }
        if proxy := os.getenv("RESOLVER_PROXY"):
            opts["proxy"] = proxy
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return ydl.sanitize_info(info) if info else {}

    async def resolve(self, url: str) -> MediaResult:
        try:
            info = await asyncio.wait_for(asyncio.to_thread(self._extract, url), timeout=self._timeout)
        except Exception as exc:  # noqa: BLE001 - classified below
            raise ResolveError(classify(exc), str(exc)[:300]) from exc
        if not info:
            raise ResolveError(classify(RuntimeError("unexpected empty response")), "yt-dlp returned nothing")
        result = normalize(info, url)
        if not result.variants and not result.metadata.title:
            raise ResolveError(classify(RuntimeError("unable to extract")), "yt-dlp found no media")
        return result
