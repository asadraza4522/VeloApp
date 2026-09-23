"""Velo media resolver — our own engine, no third-party resolver providers.

Chain: direct-image detector -> yt-dlp (full metadata + formats) ->
platform-native oEmbed (YouTube/Vimeo/SoundCloud official endpoints, metadata
only, degraded). Never downloads media; never returns or persists direct
stream URLs.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
import time
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
import yt_dlp

TIMEOUT = float(os.getenv("RESOLVER_TIMEOUT_SECONDS", "20"))
MAX_FORMATS = int(os.getenv("MAX_FORMATS", "100"))

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}

# Platform-native oEmbed endpoints (official APIs of the platforms themselves).
OEMBED_ENDPOINTS = [
    ("youtube.com", "https://www.youtube.com/oembed"),
    ("youtu.be", "https://www.youtube.com/oembed"),
    ("vimeo.com", "https://vimeo.com/api/oembed.json"),
    ("soundcloud.com", "https://soundcloud.com/oembed"),
]

PLATFORM_NAMES = {
    "youtube": "YouTube",
    "vimeo": "Vimeo",
    "soundcloud": "SoundCloud",
    "twitter": "X (Twitter)",
    "tiktok": "TikTok",
    "instagram": "Instagram",
    "twitch": "Twitch",
    "dailymotion": "Dailymotion",
    "facebook": "Facebook",
    "reddit": "Reddit",
}

# Shown when only degraded (metadata-only) resolution is available.
DEGRADED_QUALITIES = [
    {"id": "1080p-mp4", "label": "1080p MP4", "ext": "mp4", "size": ""},
    {"id": "720p-mp4", "label": "720p MP4", "ext": "mp4", "size": ""},
    {"id": "audio-mp3", "label": "MP3 audio", "ext": "mp3", "size": ""},
]


class ProviderError(Exception):
    pass


def validate_url(raw: str) -> str:
    url = raw.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only http(s) URLs are accepted")
    # Basic SSRF guard: block loopback/private/link-local/reserved destinations.
    try:
        for answer in socket.getaddrinfo(parsed.hostname, None):
            addr = ipaddress.ip_address(answer[4][0])
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                raise ValueError("Private or local destinations are not allowed")
    except socket.gaierror as exc:
        raise ValueError("Host cannot be resolved") from exc
    return url


def human_size(size: Any) -> str:
    if not size:
        return ""
    size = float(size)
    if size >= 1_000_000_000:
        return f"{size / 1_000_000_000:.1f} GB"
    if size >= 1_000_000:
        return f"{size / 1_000_000:.0f} MB"
    return f"{size / 1_000:.0f} KB"


def format_duration(seconds: Any) -> str:
    if not seconds:
        return "--:--"
    seconds = int(seconds)
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def platform_name(extractor: str | None) -> str:
    if not extractor:
        return "Web"
    key = extractor.lower().split(":")[0]
    return PLATFORM_NAMES.get(key, key.capitalize())


def compact_qualities(formats: list[dict[str, Any]], limit: int = 6) -> list[dict[str, str]]:
    best_by_height: dict[int, tuple[tuple, dict[str, Any]]] = {}
    for f in formats[:MAX_FORMATS]:
        if f.get("vcodec") in (None, "none"):
            continue
        height = f.get("height")
        if not height:
            continue
        score = (
            1 if f.get("ext") == "mp4" else 0,
            1 if f.get("acodec") not in (None, "none") else 0,
            f.get("tbr") or 0,
        )
        if height not in best_by_height or score > best_by_height[height][0]:
            best_by_height[height] = (score, f)
    qualities = []
    for height in sorted(best_by_height, reverse=True)[:limit]:
        f = best_by_height[height][1]
        ext = f.get("ext") or "mp4"
        qualities.append(
            {
                "id": f"{height}p-{ext}",
                "label": f"{height}p {ext.upper()}",
                "ext": ext,
                "size": human_size(f.get("filesize") or f.get("filesize_approx")),
            }
        )
    if any(f.get("acodec") not in (None, "none") for f in formats):
        qualities.append({"id": "audio-mp3", "label": "MP3 audio", "ext": "mp3", "size": ""})
    return qualities


def media_type(formats: list[dict[str, Any]]) -> str:
    if any(f.get("vcodec") not in (None, "none") and f.get("height") for f in formats):
        return "VIDEO"
    if formats:
        return "AUDIO"
    return "VIDEO"


def normalize(info: dict[str, Any], provider: str, url: str) -> dict[str, Any]:
    formats = info.get("formats") or []
    thumbnail = info.get("thumbnail")
    if not thumbnail and info.get("thumbnails"):
        thumbnail = info["thumbnails"][-1].get("url")
    qualities = compact_qualities(formats)
    return {
        "url": info.get("webpage_url") or url,
        "title": info.get("title") or "Untitled media",
        "creator": info.get("uploader") or info.get("channel") or "Unknown creator",
        "platform": platform_name(info.get("extractor_key") or info.get("extractor")),
        "type": media_type(formats),
        "duration": format_duration(info.get("duration")),
        "thumbnail": thumbnail,
        "provider": provider,
        "degraded": False,
        "qualities": qualities or DEGRADED_QUALITIES,
        "cached_at": time.time(),
    }


def yt_resolve(url: str) -> dict[str, Any]:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "socket_timeout": min(TIMEOUT, 15),
        "noplaylist": True,
        "extract_flat": False,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info or not info.get("title"):
        raise ProviderError("yt-dlp returned no metadata")
    return normalize(info, "yt-dlp", url)


def _is_image_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in IMAGE_EXTENSIONS)


async def image_resolve(url: str) -> dict[str, Any]:
    """Direct image links: metadata comes from headers, no extractor needed."""
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        response = await client.head(url)
        response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("image/") and not _is_image_url(url):
        raise ProviderError("not a direct image link")
    parsed = urlparse(url)
    filename = unquote(parsed.path.rsplit("/", 1)[-1]) or "image"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    size = response.headers.get("content-length")
    return {
        "url": url,
        "title": filename,
        "creator": parsed.hostname or "Web",
        "platform": parsed.hostname or "Web",
        "type": "IMAGE",
        "duration": "--:--",
        "thumbnail": url,
        "provider": "direct",
        "degraded": False,
        "qualities": [{"id": "original", "label": f"Original {ext.upper()}", "ext": ext, "size": human_size(int(size)) if size else ""}],
        "cached_at": time.time(),
    }


async def oembed_resolve(url: str) -> dict[str, Any]:
    """Metadata-only fallback via the platform's own oEmbed endpoint."""
    host = (urlparse(url).hostname or "").lower()
    endpoint = next((ep for suffix, ep in OEMBED_ENDPOINTS if host.endswith(suffix)), None)
    if not endpoint:
        raise ProviderError("no platform oEmbed endpoint for this host")
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        response = await client.get(endpoint, params={"url": url, "format": "json"})
        response.raise_for_status()
        data = response.json()
    if not data.get("title"):
        raise ProviderError("no oEmbed metadata for this URL")
    return {
        "url": url,
        "title": data["title"],
        "creator": data.get("author_name") or "Unknown creator",
        "platform": data.get("provider_name") or "Web",
        "type": "VIDEO",
        "duration": "--:--",
        "thumbnail": data.get("thumbnail_url"),
        "provider": "oembed",
        "degraded": True,
        "qualities": DEGRADED_QUALITIES,
        "cached_at": time.time(),
    }


async def resolve_media(url: str) -> dict[str, Any]:
    """Try each resolver in order; raise ProviderError if all fail."""
    url = validate_url(url)
    if _is_image_url(url):
        try:
            return await asyncio.wait_for(image_resolve(url), timeout=TIMEOUT)
        except Exception:  # noqa: BLE001 - fall through to yt-dlp
            pass
    errors = []
    for provider in (lambda: asyncio.to_thread(yt_resolve, url), lambda: oembed_resolve(url)):
        try:
            return await asyncio.wait_for(provider(), timeout=TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - chain to the next resolver
            errors.append(type(exc).__name__)
    raise ProviderError("All resolvers failed: " + ", ".join(errors))
