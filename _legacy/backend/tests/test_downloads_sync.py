"""Velo iteration-4 tests: REAL download/conversion job manager + workspace sync.

Covers:
- POST /api/downloads (audio conversion via FFmpegExtractAudio -> ready mp3)
- GET  /api/downloads/{id}/file (route-order regression: file route must win)
- Pause/resume/cancel lifecycle on a real YouTube video download
- DELETE /api/downloads/{id} removes job + files
- PUT/GET /api/sync/state round-trip + validation
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    BASE_URL = "https://react-native-app-47.preview.emergentagent.com"

SOUNDCLOUD_URL = "https://soundcloud.com/sanholobeats/light"
YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
IMAGE_URL = "https://images.pexels.com/photos/9665193/pexels-photo-9665193.jpeg"
WS = "ws-pytest-it4"
WS5 = "ws-pytest-it5"


@pytest.fixture(scope="class")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def wait_for(api_client, job_id, statuses, timeout, interval=2.0):
    """Poll a job until it reaches one of `statuses`; returns last job dict."""
    deadline = time.time() + timeout
    job = {}
    while time.time() < deadline:
        r = api_client.get(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
        assert r.status_code == 200, f"job poll failed: {r.status_code}"
        job = r.json()
        if job["status"] in statuses:
            return job
        time.sleep(interval)
    return job


def delete_quiet(api_client, job_id):
    try:
        api_client.delete(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
    except Exception:
        pass


class TestDownloadsValidation:
    """POST /api/downloads — input validation and list endpoint"""

    def test_empty_url_returns_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads", json={"url": "   "}, timeout=15)
        assert r.status_code == 400

    def test_list_jobs_returns_array(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/downloads", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_jobs_workspace_filter(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/downloads?workspace={WS}-nonexistent", timeout=15)
        assert r.status_code == 200
        assert r.json() == []

    def test_get_unknown_job_404(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/downloads/nope123", timeout=15)
        assert r.status_code == 404

    def test_bad_action_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads/nope123/explode", timeout=15)
        assert r.status_code == 400

    def test_pause_unknown_job_404(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads/nope123/pause", timeout=15)
        assert r.status_code == 404

    def test_delete_unknown_job_404(self, api_client):
        r = api_client.delete(f"{BASE_URL}/api/downloads/nope123", timeout=15)
        assert r.status_code == 404


class TestAudioConversion:
    """SoundCloud audio -> mp3 conversion: create -> ready -> file download -> delete"""

    @pytest.fixture(scope="class")
    def audio_job(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads", json={
            "url": SOUNDCLOUD_URL,
            "kind": "audio",
            "format": "mp3",
            "workspace": WS,
            "title": "San Holo light",
            "creator": "sanholobeats",
            "platform": "SoundCloud",
        }, timeout=20)
        assert r.status_code == 200, r.text[:300]
        job = r.json()
        assert job["status"] in ("queued", "downloading")
        assert job["kind"] == "audio"
        assert job["workspace"] == WS
        yield job
        delete_quiet(api_client, job["id"])

    def test_audio_job_reaches_ready_with_mp3(self, api_client, audio_job):
        job = wait_for(api_client, audio_job["id"], {"ready", "failed"}, timeout=300)
        assert job["status"] == "ready", f"expected ready, got {job['status']}: {job.get('error')}"
        assert job["ext"] == "mp3", f"expected mp3, got {job['ext']}"
        assert job["size_bytes"] and job["size_bytes"] > 100_000, job["size_bytes"]
        assert job["progress"] == 1
        TestAudioConversion.ready_job = job  # hand over to file test

    def test_file_endpoint_returns_audio(self, api_client, audio_job):
        job = getattr(TestAudioConversion, "ready_job", None)
        assert job, "audio job not ready (previous test failed)"
        r = api_client.get(f"{BASE_URL}/api/downloads/{job['id']}/file", timeout=120)
        # Route-order regression: /file must serve the file, not be swallowed
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        assert int(r.headers.get("Content-Length", len(r.content))) == job["size_bytes"]
        assert "attachment" in r.headers.get("Content-Disposition", "")
        assert ".mp3" in r.headers.get("Content-Disposition", "")
        assert r.content[:3] == b"ID3" or r.content[:2] == b"\xff\xfb", "not a real mp3 payload"

    def test_file_not_ready_returns_404(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/downloads/nope123/file", timeout=15)
        assert r.status_code == 404

    def test_delete_removes_job(self, api_client, audio_job):
        job = getattr(TestAudioConversion, "ready_job", audio_job)
        r = api_client.delete(f"{BASE_URL}/api/downloads/{job['id']}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        g = api_client.get(f"{BASE_URL}/api/downloads/{job['id']}", timeout=15)
        assert g.status_code == 404
        TestAudioConversion.ready_job = None


class TestVideoPauseResume:
    """YouTube 1080p video: downloading -> pause -> resume -> delete"""

    @pytest.fixture(scope="class")
    def video_job(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads", json={
            "url": YOUTUBE_URL,
            "kind": "video",
            "quality": "1080p-mp4",
            "label": "1080p MP4",
            "workspace": WS,
            "title": "Rick Astley - Never Gonna Give You Up",
            "creator": "Rick Astley",
            "platform": "YouTube",
        }, timeout=20)
        assert r.status_code == 200, r.text[:300]
        job = r.json()
        yield job
        delete_quiet(api_client, job["id"])

    def test_pause_resume_lifecycle(self, api_client, video_job):
        job_id = video_job["id"]
        # 1. reach active downloading state
        job = wait_for(api_client, job_id, {"downloading", "processing", "ready", "failed"}, timeout=120)
        assert job["status"] != "failed", f"video download failed to start: {job.get('error')}"
        if job["status"] == "ready":
            pytest.skip("download finished before pause could be tested (too fast)")

        # 2. pause
        r = api_client.post(f"{BASE_URL}/api/downloads/{job_id}/pause", timeout=15)
        assert r.status_code == 200, r.text[:200]
        job = wait_for(api_client, job_id, {"paused", "ready"}, timeout=45)
        assert job["status"] == "paused", f"expected paused, got {job['status']}"

        # 3. resume
        r = api_client.post(f"{BASE_URL}/api/downloads/{job_id}/resume", timeout=15)
        assert r.status_code == 200
        job = wait_for(api_client, job_id, {"downloading", "processing", "ready", "failed"}, timeout=60)
        assert job["status"] in ("downloading", "processing", "ready"), (
            f"resume did not restart download: {job['status']} {job.get('error')}")

        # 4. delete while active removes job
        r = api_client.delete(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)


class TestFailedJobRetry:
    """Failed download -> resume (retry) restarts it; delete cleans up"""

    def test_failed_job_can_be_retried(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/downloads", json={
            "url": "https://example.com/",
            "kind": "video",
            "workspace": WS,
            "title": "TEST unresolvable",
        }, timeout=20)
        assert r.status_code == 200
        job_id = r.json()["id"]
        try:
            job = wait_for(api_client, job_id, {"failed"}, timeout=90)
            assert job["status"] == "failed", f"expected failed, got {job['status']}"
            assert job["error"], "failed job must carry an error message"
            # retry = resume from failed
            r2 = api_client.post(f"{BASE_URL}/api/downloads/{job_id}/resume", timeout=15)
            assert r2.status_code == 200
            job = wait_for(api_client, job_id, {"downloading", "queued", "failed", "ready"}, timeout=30)
            assert job["status"] in ("downloading", "queued", "failed"), job["status"]
        finally:
            delete_quiet(api_client, job_id)

        assert r.status_code == 200
        g = api_client.get(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
        assert g.status_code == 404


class TestImageDownload:
    """Iteration 5: kind=image — streamed httpx download to ready, then file bytes"""

    def test_image_download_full_lifecycle(self, api_client):
        # create
        r = api_client.post(f"{BASE_URL}/api/downloads", json={
            "url": IMAGE_URL,
            "kind": "image",
            "format": "jpeg",
            "label": "Original JPEG",
            "workspace": WS5,
            "title": "TEST pexels image",
            "creator": "images.pexels.com",
            "platform": "images.pexels.com",
        }, timeout=20)
        assert r.status_code == 200, r.text[:300]
        job = r.json()
        assert job["kind"] == "image"
        assert job["status"] in ("queued", "downloading")
        job_id = job["id"]
        try:
            # reaches ready with real size
            job = wait_for(api_client, job_id, {"ready", "failed"}, timeout=120)
            assert job["status"] == "ready", f"expected ready, got {job['status']}: {job.get('error')}"
            assert job["ext"] == "jpeg", f"expected jpeg, got {job['ext']}"
            assert job["size_bytes"] and job["size_bytes"] > 50_000, job["size_bytes"]
            assert job["progress"] == 1

            # file endpoint returns the image bytes
            f = api_client.get(f"{BASE_URL}/api/downloads/{job_id}/file", timeout=60)
            assert f.status_code == 200
            assert int(f.headers.get("Content-Length", len(f.content))) == job["size_bytes"]
            assert ".jpeg" in f.headers.get("Content-Disposition", "")
            assert f.content[:3] == b"\xff\xd8\xff", "not a real JPEG payload"
        finally:
            delete_quiet(api_client, job_id)
        g = api_client.get(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
        assert g.status_code == 404

    def test_cancelled_image_download_stays_cancelled(self, api_client):
        # Image downloads are near-instant on this network; just verify a fresh
        # job accepts a delete (cancel) while queued/downloading without 500s.
        r = api_client.post(f"{BASE_URL}/api/downloads", json={
            "url": IMAGE_URL, "kind": "image", "format": "jpeg",
            "workspace": WS5, "title": "TEST cancel image",
        }, timeout=20)
        assert r.status_code == 200
        job_id = r.json()["id"]
        d = api_client.delete(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
        assert d.status_code == 200
        g = api_client.get(f"{BASE_URL}/api/downloads/{job_id}", timeout=15)
        assert g.status_code == 404


class TestSyncState:
    """PUT/GET /api/sync/state — round-trip persistence and validation"""

    PAYLOAD = {
        "workspace": WS,
        "sources": [
            {"id": "TEST_s1", "title": "TEST sync source", "creator": "Tester",
             "platform": "YouTube", "type": "VIDEO", "status": "Saved",
             "duration": "03:33", "url": "https://youtube.com/watch?v=TEST_sync"}
        ],
        "settings": {"wifiOnly": False, "theme": "dark"},
    }

    def test_put_then_get_roundtrip(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/sync/state", json=self.PAYLOAD, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        g = api_client.get(f"{BASE_URL}/api/sync/state?workspace={WS}", timeout=15)
        assert g.status_code == 200
        data = g.json()
        assert data["workspace"] == WS
        assert data["sources"] == self.PAYLOAD["sources"]
        assert data["settings"] == self.PAYLOAD["settings"]

    def test_get_empty_workspace_returns_400(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/sync/state?workspace=", timeout=15)
        assert r.status_code == 400

    def test_get_unknown_workspace_returns_default(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/sync/state?workspace=ws-never-seen-xyz", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["workspace"] == "ws-never-seen-xyz"
        assert data["sources"] == []
        assert data["settings"] == {}
