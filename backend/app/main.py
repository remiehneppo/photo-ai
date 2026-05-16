import os
import logging
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import engine
from app.models import User, Job, Image
from app.database import Base
from app.routers import auth, capabilities, generate, edit, upscale, sharpen, outpaint, jobs
from app.config import STORAGE_PATH
from app.logging_config import configure_logging

configure_logging()
logger = logging.getLogger("photo_ai.api")

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Photo AI API", version="1.0.0")


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
app.include_router(upscale.router)
app.include_router(sharpen.router)
app.include_router(outpaint.router)
app.include_router(jobs.router)

# Serve stored images
os.makedirs(f"{STORAGE_PATH}/input", exist_ok=True)
os.makedirs(f"{STORAGE_PATH}/output", exist_ok=True)
app.mount("/api/images/input", StaticFiles(directory=f"{STORAGE_PATH}/input"), name="input-images")
app.mount("/api/images/output", StaticFiles(directory=f"{STORAGE_PATH}/output"), name="output-images")


@app.get("/health")
async def health():
    from app.services.a1111_client import a1111
    a1111_ok = await a1111.health_check()
    return {"status": "ok", "a1111": "connected" if a1111_ok else "disconnected"}
