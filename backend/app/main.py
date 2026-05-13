import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import engine
from app.models import User, Job, Image
from app.database import Base
from app.routers import auth, generate, edit, upscale, outpaint, jobs
from app.config import STORAGE_PATH

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Photo AI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(generate.router)
app.include_router(edit.router)
app.include_router(upscale.router)
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
