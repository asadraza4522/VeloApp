"""Velo Lite (Play) vs Full (docs/VELO_TECHNICAL_PLAN.md §7.5).

Lite may only fetch direct file URLs and allow-listed hosts. This is defence in depth: the Lite app
binary also excludes the third-party resolvers at build time. Play Integrity attestation of the
`lite` claim is added before the Play release (Phase 10)."""

from __future__ import annotations

from urllib.parse import urlparse

from app.failures import FailureCode, ResolveError

LITE_ALLOWED_HOSTS = (
    "archive.org", "wikimedia.org", "wikipedia.org", "pixabay.com", "pexels.com",
    "freemusicarchive.org", "openverse.org", "commons.wikimedia.org",
)

MEDIA_EXTENSIONS = {
    "video": {".mp4", ".webm", ".mkv", ".mov", ".m4v", ".3gp"},
    "audio": {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".oga", ".wav", ".flac"},
    "image": {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"},
}
ALL_MEDIA_EXTENSIONS = set().union(*MEDIA_EXTENSIONS.values())


def extension(url: str) -> str:
    path = urlparse(url).path.lower()
    dot = path.rfind(".")
    return path[dot:] if dot != -1 and "/" not in path[dot:] else ""


def is_direct_file(url: str) -> bool:
    return extension(url) in ALL_MEDIA_EXTENSIONS


def host_allowed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in LITE_ALLOWED_HOSTS)


def enforce(distribution: str, url: str) -> None:
    if distribution == "lite" and not (is_direct_file(url) or host_allowed(url)):
        raise ResolveError(FailureCode.UNSUPPORTED, "This link is not supported in Velo Lite")
