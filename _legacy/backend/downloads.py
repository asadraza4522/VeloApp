"""Velo download/conversion job manager.

Runs yt-dlp downloads in background threads with live progress, pause/resume
(yt-dlp keeps .part files, so resume continues where it stopped) and audio
extraction via FFmpeg postprocessors. Jobs live in memory for fast polling and
are mirrored to MongoDB so the queue survives restarts.
"""

from __future__ import annotations

import glob
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import pymongo
import yt_dlp
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

DOWNLOAD_DIR = Path(__file__).parent / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

_mirror_client = pymongo.MongoClient(os.environ["MONGO_URL"])
_collection = _mirror_client[os.environ["DB_NAME"]]["download_jobs"]

MIRROR_INTERVAL_SECONDS = 1.0
ACTIVE_STATUSES = {"queued", "downloading", "processing"}


class PauseRequested(Exception):
    pass


class CancelRequested(Exception):
    pass


JOBS: dict[str, dict[str, Any]] = {}


def _public(job: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def _mirror(job: dict[str, Any], force: bool = False) -> None:
    if job.get("_deleted"):
        return  # deleted jobs must not resurrect in Mongo after removal
    now = time.time()
    if not force and now - job.get("_last_mirror", 0) < MIRROR_INTERVAL_SECONDS:
        return
    job["_last_mirror"] = now
    try:
        _collection.update_one({"id": job["id"]}, {"$set": _public(job)}, upsert=True)
    except Exception:
        pass  # mirror is best-effort; memory stays authoritative


def load_jobs() -> None:
    """Restore jobs from MongoDB at startup; interrupted work becomes paused."""
    try:
        for doc in _collection.find({}, {"_id": 0}):
            if doc.get("status") in ACTIVE_STATUSES:
                doc["status"] = "paused"
                doc["error"] = "Interrupted by server restart"
            JOBS[doc["id"]] = doc
    except Exception:
        pass


def get_job(job_id: str) -> dict[str, Any] | None:
    job = JOBS.get(job_id)
    return _public(job) if job else None


def list_jobs(workspace: str | None = None) -> list[dict[str, Any]]:
    jobs = [j for j in JOBS.values() if not workspace or j.get("workspace") == workspace]
    return [_public(j) for j in sorted(jobs, key=lambda j: j.get("created_at", 0), reverse=True)]


def _video_format_selector(quality: str) -> str:
    height = quality.split("p")[0] if quality else ""
    if height.isdigit():
        return (
            f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
            f"bestvideo[height<={height}]+bestaudio/"
            f"best[height<={height}][ext=mp4]/best[height<={height}]/best"
        )
    return "best[ext=mp4]/best"


def _find_output(job_id: str) -> tuple[str | None, str | None]:
    for path in sorted(glob.glob(str(DOWNLOAD_DIR / f"{job_id}.*"))):
        name = os.path.basename(path)
        if ".part" in name or name.endswith(".ytdl") or ".part-Frag" in name:
            continue
        return path, name.rsplit(".", 1)[-1]
    return None, None


def _run_image(job: dict[str, Any]) -> None:
    """Direct image download — streamed with progress, no extractor needed."""
    job["status"] = "downloading"
    job["updated_at"] = time.time()
    _mirror(job, force=True)
    try:
        ext = job.get("format") or "jpg"
        path = str(DOWNLOAD_DIR / f"{job['id']}.{ext}")
        with httpx.stream("GET", job["url"], follow_redirects=True, timeout=60) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length") or 0)
            downloaded = 0
            with open(path, "wb") as fh:
                for chunk in response.iter_bytes(65536):
                    if job.get("_control") == "cancel":
                        raise CancelRequested()
                    fh.write(chunk)
                    downloaded += len(chunk)
                    job["progress"] = round(downloaded / total, 4) if total else 0
                    job["size_bytes"] = total or None
                    job["updated_at"] = time.time()
                    _mirror(job)
        job["status"] = "ready"
        job["progress"] = 1
        job["ext"] = ext
        job["size_bytes"] = os.path.getsize(path)
    except CancelRequested:
        job["status"] = "cancelled"
    except Exception as exc:  # noqa: BLE001
        job["status"] = "failed"
        job["error"] = str(exc)[:300]
    finally:
        job["_control"] = None
        job["updated_at"] = time.time()
        _mirror(job, force=True)


def _run(job: dict[str, Any]) -> None:
    if job.get("kind") == "image":
        _run_image(job)
        return
    job_id = job["id"]

    def hook(d: dict[str, Any]) -> None:
        control = job.get("_control")
        if control == "pause":
            raise PauseRequested()
        if control == "cancel":
            raise CancelRequested()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            job["status"] = "downloading"
            job["progress"] = round(downloaded / total, 4) if total else 0
            job["speed_bps"] = d.get("speed")
            job["eta_seconds"] = d.get("eta")
            job["size_bytes"] = total or None
            job["updated_at"] = time.time()
            _mirror(job)
        elif d.get("status") == "finished":
            job["status"] = "processing" if job.get("kind") == "audio" else job["status"]
            job["progress"] = 1
            _mirror(job, force=True)

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "continuedl": True,
        "outtmpl": str(DOWNLOAD_DIR / f"{job_id}.%(ext)s"),
        "progress_hooks": [hook],
        "socket_timeout": 30,
        "retries": 3,
    }
    if job.get("kind") == "audio":
        codec = job.get("format", "mp3")
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": codec,
                "preferredquality": "320" if codec == "mp3" else "256",
            }
        ]
    else:
        opts["format"] = _video_format_selector(job.get("quality", ""))
        opts["merge_output_format"] = "mp4"

    job["status"] = "downloading"
    job["updated_at"] = time.time()
    _mirror(job, force=True)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([job["url"]])
        path, ext = _find_output(job_id)
        if not path:
            raise RuntimeError("output file missing after download")
        job["status"] = "ready"
        job["progress"] = 1
        job["ext"] = ext
        job["size_bytes"] = os.path.getsize(path)
        job["speed_bps"] = None
        job["eta_seconds"] = None
    except PauseRequested:
        job["status"] = "paused"
    except CancelRequested:
        job["status"] = "cancelled"
    except Exception as exc:  # noqa: BLE001 - surface any yt-dlp failure
        if "PauseRequested" in type(exc).__name__ or job.get("_control") == "pause":
            job["status"] = "paused"
        elif "CancelRequested" in type(exc).__name__ or job.get("_control") == "cancel":
            job["status"] = "cancelled"
        else:
            job["status"] = "failed"
            job["error"] = str(exc)[:300]
    finally:
        job["_control"] = None
        job["updated_at"] = time.time()
        _mirror(job, force=True)


def create_job(payload: dict[str, Any]) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    job: dict[str, Any] = {
        "id": job_id,
        "url": payload["url"],
        "kind": payload.get("kind", "video"),
        "quality": payload.get("quality", ""),
        "format": payload.get("format", "mp3"),
        "label": payload.get("label") or payload.get("quality") or "Best",
        "workspace": payload.get("workspace", ""),
        "title": payload.get("title") or "Untitled media",
        "creator": payload.get("creator") or "Unknown creator",
        "platform": payload.get("platform") or "Web",
        "duration": payload.get("duration") or "--:--",
        "thumbnail": payload.get("thumbnail"),
        "status": "queued",
        "progress": 0,
        "speed_bps": None,
        "eta_seconds": None,
        "size_bytes": None,
        "ext": None,
        "error": None,
        "created_at": time.time(),
        "updated_at": time.time(),
        "_control": None,
        "_last_mirror": 0,
    }
    JOBS[job_id] = job
    _mirror(job, force=True)
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return _public(job)


def control_job(job_id: str, action: str) -> dict[str, Any] | None:
    job = JOBS.get(job_id)
    if not job:
        return None
    if action == "pause" and job["status"] in ACTIVE_STATUSES:
        job["_control"] = "pause"
        job["status"] = "paused" if job["status"] == "queued" else job["status"]
        _mirror(job, force=True)
    elif action == "resume" and job["status"] in {"paused", "failed"}:
        job["error"] = None
        job["_control"] = None
        threading.Thread(target=_run, args=(job,), daemon=True).start()
    return _public(job)


def delete_job(job_id: str) -> bool:
    job = JOBS.get(job_id)
    if not job:
        return False
    job["_deleted"] = True
    if job["status"] in ACTIVE_STATUSES:
        job["_control"] = "cancel"
    for path in glob.glob(str(DOWNLOAD_DIR / f"{job_id}.*")):
        try:
            os.remove(path)
        except OSError:
            pass
    JOBS.pop(job_id, None)
    try:
        _collection.delete_one({"id": job_id})
    except Exception:
        pass
    return True


def job_file(job_id: str) -> tuple[str | None, str]:
    job = JOBS.get(job_id)
    if not job or job.get("status") != "ready":
        return None, ""
    path, ext = _find_output(job_id)
    if not path:
        return None, ""
    safe_title = re.sub(r"[^\w\-]+", "_", job.get("title") or "velo-media")[:60].strip("_") or "velo-media"
    return path, f"{safe_title}.{ext}"
