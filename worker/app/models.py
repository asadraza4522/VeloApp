"""Normalized media model (PRD §24). Every resolver converts its raw output into this."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MediaKind = Literal["video", "audio", "image", "file"]


class MediaVariant(BaseModel):
    id: str
    type: MediaKind
    label: str
    container: str
    url: str                                   # direct URL the phone downloads
    headers: dict[str, str] = Field(default_factory=dict)  # headers the CDN needs
    protocol: Literal["https", "hls", "dash"] = "https"
    has_video: bool
    has_audio: bool
    video_codec: str | None = None
    audio_codec: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    bitrate: int | None = None                 # bits per second
    filesize: int | None = None
    ip_bound: bool | None = None               # URL is tied to the resolver's IP (may 403 on the phone)


class MediaMetadata(BaseModel):
    source_url: str
    title: str | None = None
    description: str | None = None
    creator: str | None = None
    creator_id: str | None = None
    platform: str
    platform_media_id: str | None = None
    thumbnail_url: str | None = None
    published_at: str | None = None            # ISO 8601
    duration: float | None = None              # seconds
    media_type: Literal["video", "audio", "image", "file", "unknown"] = "unknown"


class MediaResult(BaseModel):
    resolver_id: str
    metadata: MediaMetadata
    variants: list[MediaVariant]               # empty = metadata-only (nothing downloadable)
    resolved_at: float
    expires_at: float | None = None            # epoch seconds; direct URLs are short-lived
    degraded: bool = False
