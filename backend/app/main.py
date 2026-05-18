import logging
import os
import time
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import STORAGE_PATH
from app.database import SessionLocal
from app.logging_config import configure_logging
from app.models import Job
from app.routers import auth, background, capabilities, depth_guide, edit, face_restore, generate, images, inpaint, interrogate, jobs, outpaint, pose_control, restore, sharpen, sketch_to_photo, suggestions, upscale, variations

configure_logging()
logger = logging.getLogger("photo_ai.api")


def _cleanup_stale_jobs() -> None:
    """Mark pending/processing jobs as failed on startup (they can never complete)."""
    from datetime import datetime
    db = SessionLocal()
    try:
        stale = db.query(Job).filter(Job.status.in_(["pending", "processing"])).all()
        if stale:
            for job in stale:
                job.status = "failed"
                job.error_message = "Server restarted while job was running"
                job.progress_label = "Failed"
                job.completed_at = datetime.utcnow()
            db.commit()
            logger.info("startup_cleanup stale_jobs_reset=%d", len(stale))
    finally:
        db.close()


app = FastAPI(title="Photo AI API", version="1.0.0")


@app.on_event("startup")
def startup_cleanup() -> None:
    _cleanup_stale_jobs()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.exception(
                "request_failed request_id=%s method=%s path=%s duration_ms=%s",
                request_id,
                request.method,
                request.url.path,
                duration_ms,
            )
            raise

        duration_ms = int((time.perf_counter() - start) * 1000)
        response.headers["x-request-id"] = request_id
        log = logger.warning if response.status_code >= 400 else logger.info
        log(
            "request_done request_id=%s method=%s path=%s status=%s duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response


app.add_middleware(RequestLoggingMiddleware)


class NoStoreImagesMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/images/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app.add_middleware(NoStoreImagesMiddleware)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://photo-ai.suprenam.id.vn",
        "https://photo-ai.suprenam.id.vn",
        "http://photo-be.suprenam.id.vn",
        "https://photo-be.suprenam.id.vn",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(capabilities.router)
app.include_router(generate.router)
app.include_router(edit.router)
app.include_router(inpaint.router)
app.include_router(interrogate.router)
app.include_router(upscale.router)
app.include_router(sharpen.router)
app.include_router(outpaint.router)
app.include_router(images.router)
app.include_router(jobs.router)
app.include_router(suggestions.router)
app.include_router(face_restore.router)
app.include_router(variations.router)
app.include_router(sketch_to_photo.router)
app.include_router(pose_control.router)
app.include_router(depth_guide.router)
app.include_router(restore.router)
app.include_router(background.router)

os.makedirs(f"{STORAGE_PATH}/input", exist_ok=True)
os.makedirs(f"{STORAGE_PATH}/output", exist_ok=True)


@app.get("/health")
async def health():
    from app.services.a1111_client import a1111

    a1111_ok = await a1111.health_check()
    return {"status": "ok", "a1111": "connected" if a1111_ok else "disconnected"}
