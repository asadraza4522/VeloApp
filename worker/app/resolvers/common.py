from __future__ import annotations

from urllib.parse import urlparse

PLATFORM_HOSTS: list[tuple[str, str]] = [
    ("youtube.com", "YouTube"), ("youtu.be", "YouTube"), ("youtube-nocookie.com", "YouTube"),
    ("instagram.com", "Instagram"), ("tiktok.com", "TikTok"), ("facebook.com", "Facebook"), ("fb.watch", "Facebook"),
    ("twitter.com", "X"), ("x.com", "X"), ("reddit.com", "Reddit"), ("pinterest.com", "Pinterest"),
    ("vimeo.com", "Vimeo"), ("soundcloud.com", "SoundCloud"), ("dailymotion.com", "Dailymotion"),
    ("twitch.tv", "Twitch"), ("archive.org", "Internet Archive"),
]


def detect_platform(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    for suffix, name in PLATFORM_HOSTS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return "Other"
