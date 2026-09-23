"""Velo resolver worker. Private: only Supabase Edge Functions call it (shared secret)."""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.failures import ResolveError
from app.health import HealthTracker, sink_from_env
from app.manager import ResolveFailed, ResolverManager
from app.models import MediaResult
from app.resolvers.direct import DirectResolver
from app.resolvers.gallerydl import GalleryDlResolver
from app.resolvers.oembed import OEmbedResolver
from app.resolvers.ytdlp import YtDlpResolver

log = logging.getLogger("velo.worker")
HEALTH_FLUSH_SECONDS = 60


def build_manager(health: HealthTracker | None = None) -> ResolverManager:
    timeout = float(os.getenv("RESOLVER_TIMEOUT_SECONDS", "25"))
    return ResolverManager(
        [DirectResolver(), YtDlpResolver(timeout), GalleryDlResolver(timeout), OEmbedResolver()],
        health=health, max_concurrency=int(os.getenv("MAX_CONCURRENCY", "8")),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    sink = sink_from_env()
    task = None
    if sink:
        async def flusher():
            while True:
                await asyncio.sleep(HEALTH_FLUSH_SECONDS)
                await sink.flush(app.state.manager.health)
        task = asyncio.create_task(flusher())
    yield
    if task:
        task.cancel()


app = FastAPI(title="velo-worker", lifespan=lifespan)
app.state.manager = build_manager()


def require_secret(authorization: str | None = Header(default=None)) -> None:
    secret = os.getenv("WORKER_SHARED_SECRET", "")
    header = authorization or ""
    supplied = header[7:].strip() if header.startswith("Bearer ") else ""
    if not secret or not supplied or not hmac.compare_digest(supplied.encode(), secret.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


class ResolveRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    distribution: str = Field(default="full", pattern="^(full|lite)$")


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/v1/resolve", dependencies=[Depends(require_secret)])
async def resolve(req: ResolveRequest):
    """200 always for domain outcomes: {ok: true, result} or {ok: false, error{code, message, attempts}}."""
    try:
        result: MediaResult = await app.state.manager.resolve(req.url, distribution=req.distribution)
    except ResolveFailed as exc:
        return {"ok": False, "error": {"code": exc.code, "message": exc.message,
                                        "attempts": [{"resolver": a.resolver_id, "ok": a.ok, "code": a.code, "ms": a.ms} for a in exc.attempts]}}
    except ResolveError as exc:
        return {"ok": False, "error": {"code": exc.code, "message": exc.message, "attempts": []}}
    return {"ok": True, "result": result.model_dump()}
