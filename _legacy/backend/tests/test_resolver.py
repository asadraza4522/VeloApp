"""Velo resolver API tests — POST /api/resolve (own engine: yt-dlp -> oEmbed -> direct image) and GET /api/resolve/health."""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    BASE_URL = "https://react-native-app-47.preview.emergentagent.com"

YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
SOUNDCLOUD_URL = "https://soundcloud.com/sanholobeats/light"
UNRESOLVABLE_URL = "https://example.com/"
IMAGE_URL = "https://images.pexels.com/photos/9665193/pexels-photo-9665193.jpeg"


@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestResolveHealth:
    """GET /api/resolve/health — provider chain listing"""

    def test_health_returns_provider_chain(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/resolve/health", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        # Iteration 5: cobalt + noembed removed; own-engine chain only.
        # Order also documents the oEmbed fallback position (after yt-dlp).
        assert data["providerChain"] == ["yt-dlp", "oembed", "direct-image"]
        assert "cobalt" not in data["providerChain"] and "noembed" not in data["providerChain"]


class TestResolveYouTube:
    """POST /api/resolve — real YouTube URL, full metadata + cache verification"""

    def test_youtube_resolves_with_real_metadata(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": YOUTUBE_URL}, timeout=90)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data["provider"] == "yt-dlp"
        assert data["degraded"] is False
        assert "Rick Astley" in data["title"] or "Never Gonna Give You Up" in data["title"]
        assert data["creator"], "creator must be present"
        assert data["platform"] == "YouTube"
        assert data["type"] == "VIDEO"
        assert data["duration"] and data["duration"] != "--:--"
        assert data["thumbnail"] and data["thumbnail"].startswith("http")
        # Real quality list from yt-dlp formats (heights + MP3 audio)
        ids = [q["id"] for q in data["qualities"]]
        assert "audio-mp3" in ids
        video_ids = [i for i in ids if i.endswith("-mp4")]
        assert len(video_ids) >= 2, f"expected multiple video qualities, got {ids}"
        labels = [q["label"] for q in data["qualities"]]
        assert any("2160p" in l or "1440p" in l or "1080p" in l for l in labels), labels

    def test_second_call_returns_cached(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": YOUTUBE_URL}, timeout=90)
        assert r.status_code == 200
        data = r.json()
        assert data.get("cached") is True, f"expected cached:true, got {data.get('cached')}"
        # Cached payload must still carry full metadata
        assert data["title"] and data["qualities"]


class TestResolveSoundCloud:
    """POST /api/resolve — SoundCloud URL resolves as AUDIO with MP3 quality"""

    def test_soundcloud_resolves_as_audio(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": SOUNDCLOUD_URL}, timeout=90)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data["type"] == "AUDIO"
        ids = [q["id"] for q in data["qualities"]]
        assert "audio-mp3" in ids, ids


class TestResolveImage:
    """POST /api/resolve — direct image URL detected via HEAD request (iteration 5)"""

    def test_image_url_resolves_as_image_type(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": IMAGE_URL}, timeout=60)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data["type"] == "IMAGE", f"expected IMAGE, got {data['type']}"
        assert data["provider"] == "direct", f"expected provider=direct, got {data['provider']}"
        assert data["degraded"] is False
        assert data["title"].endswith(".jpeg")
        assert data["thumbnail"] == IMAGE_URL
        assert data["duration"] == "--:--"

    def test_image_quality_is_original_jpeg(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": IMAGE_URL}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        assert len(data["qualities"]) == 1
        q = data["qualities"][0]
        assert q["id"] == "original"
        assert q["label"] == "Original JPEG"
        assert q["ext"] == "jpeg"
        assert q["size"], "size should come from Content-Length header"


class TestResolveValidation:
    """POST /api/resolve — validation, SSRF guard, provider chain failure"""

    def test_invalid_url_returns_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": "hello"}, timeout=15)
        assert r.status_code == 400

    def test_empty_url_returns_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": "   "}, timeout=15)
        assert r.status_code == 400

    def test_loopback_url_blocked_by_ssrf_guard(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": "http://127.0.0.1:8001/api/"}, timeout=15)
        assert r.status_code == 400
        assert "Private" in r.json()["detail"] or "local" in r.json()["detail"]

    def test_private_ip_blocked_by_ssrf_guard(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": "http://192.168.1.1/admin"}, timeout=15)
        assert r.status_code == 400

    def test_unresolvable_url_returns_502_with_chain_detail(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/resolve", json={"url": UNRESOLVABLE_URL}, timeout=90)
        assert r.status_code == 502, f"expected 502, got {r.status_code}: {r.text[:300]}"
        # NOTE: the public ingress replaces the app's JSON 502 body with an HTML
        # error page. The app itself returns JSON detail (verified on :8001):
        # {"detail": "All resolvers failed: DownloadError, ProviderError"}
        if "application/json" in r.headers.get("Content-Type", ""):
            assert "All resolvers failed" in r.json()["detail"]
        else:
            pytest.skip("public ingress intercepts 502 with HTML page; app JSON detail verified internally")
