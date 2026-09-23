from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import time
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Any, List, Optional
import uuid
from datetime import datetime

from resolver import resolve_media, ProviderError
from downloads import create_job, list_jobs, get_job, control_job, delete_job, job_file, load_jobs


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

RESOLVER_CACHE_TTL_SECONDS = 6 * 60 * 60

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

class ResolveRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    kind: str = "video"           # "video" | "audio"
    quality: str = ""             # e.g. "1080p" (video)
    format: str = "mp3"           # mp3 | m4a | opus (audio)
    label: str = ""
    workspace: str = ""
    title: str = ""
    creator: str = ""
    platform: str = ""
    duration: str = ""
    thumbnail: Optional[str] = None

class SyncState(BaseModel):
    workspace: str
    sources: List[dict[str, Any]] = []
    settings: dict[str, Any] = {}

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# --- Media resolver -----------------------------------------------------------

@api_router.get("/resolve/health")
async def resolve_health():
    return {"status": "ok", "providerChain": ["yt-dlp", "oembed", "direct-image"]}


@api_router.post("/resolve")
async def resolve_endpoint(payload: ResolveRequest):
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    cached = await db.media_metadata.find_one({"url": url}, {"_id": 0})
    if cached and time.time() - cached.get("cached_at", 0) < RESOLVER_CACHE_TTL_SECONDS:
        return {**cached, "cached": True}

    try:
        data = await resolve_media(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    await db.media_metadata.update_one({"url": url}, {"$set": data}, upsert=True)
    return {**data, "cached": False}


# --- Downloads / conversions --------------------------------------------------

@api_router.post("/downloads")
async def downloads_create(payload: DownloadRequest):
    if not payload.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    return create_job(payload.dict())


@api_router.get("/downloads")
async def downloads_list(workspace: str = ""):
    return list_jobs(workspace or None)


@api_router.get("/downloads/{job_id}")
async def downloads_get(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@api_router.get("/downloads/{job_id}/file")
async def downloads_file(job_id: str, request: Request):
    path, filename = job_file(job_id)
    if not path:
        raise HTTPException(status_code=404, detail="file not ready")
    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")
    if range_header:
        # Single byte-range support — media players (web <video>, AVPlayer)
        # need 206 partial responses for seeking/streaming.
        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if match:
            start_s, end_s = match.groups()
            if start_s:
                start = int(start_s)
                end = int(end_s) if end_s else file_size - 1
            else:  # suffix range: last N bytes
                start = max(0, file_size - int(end_s))
                end = file_size - 1
            end = min(end, file_size - 1)
            if start > end or start >= file_size:
                raise HTTPException(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
            length = end - start + 1

            def iter_range():
                with open(path, "rb") as fh:
                    fh.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = fh.read(min(1024 * 256, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            return StreamingResponse(
                iter_range(),
                status_code=206,
                media_type="application/octet-stream",
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(length),
                    "Content-Disposition": f'attachment; filename="{filename}"',
                },
            )
    response = FileResponse(path, filename=filename, media_type="application/octet-stream")
    response.headers["Accept-Ranges"] = "bytes"
    return response


@api_router.post("/downloads/{job_id}/{action}")
async def downloads_control(job_id: str, action: str):
    if action not in {"pause", "resume"}:
        raise HTTPException(status_code=400, detail="action must be pause or resume")
    job = control_job(job_id, action)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@api_router.delete("/downloads/{job_id}")
async def downloads_delete(job_id: str):
    if not delete_job(job_id):
        raise HTTPException(status_code=404, detail="job not found")
    return {"ok": True}


# --- Workspace sync -----------------------------------------------------------

@api_router.get("/sync/state")
async def sync_get(workspace: str = ""):
    if not workspace:
        raise HTTPException(status_code=400, detail="workspace is required")
    doc = await db.workspaces.find_one({"workspace": workspace}, {"_id": 0})
    return doc or {"workspace": workspace, "sources": [], "settings": {}}


@api_router.put("/sync/state")
async def sync_put(state: SyncState):
    await db.workspaces.update_one(
        {"workspace": state.workspace},
        {"$set": {**state.dict(), "updated_at": time.time()}},
        upsert=True,
    )
    return {"ok": True}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_load_jobs():
    load_jobs()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
