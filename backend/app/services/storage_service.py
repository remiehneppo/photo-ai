import os
import uuid
import aiofiles
from pathlib import Path
from app.config import STORAGE_PATH


def _ensure_dirs():
    Path(f"{STORAGE_PATH}/input").mkdir(parents=True, exist_ok=True)
    Path(f"{STORAGE_PATH}/output").mkdir(parents=True, exist_ok=True)


async def save_upload(image_bytes: bytes, suffix: str = ".png") -> tuple[str, str]:
    """Save uploaded image. Returns (file_path, filename)."""
    _ensure_dirs()
    filename = f"{uuid.uuid4()}{suffix}"
    file_path = os.path.join(STORAGE_PATH, "input", filename)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(image_bytes)
    return file_path, filename


async def save_output(image_bytes: bytes) -> tuple[str, str]:
    """Save generated image. Returns (file_path, filename)."""
    _ensure_dirs()
    filename = f"{uuid.uuid4()}.png"
    file_path = os.path.join(STORAGE_PATH, "output", filename)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(image_bytes)
    return file_path, filename


def get_image_url(filename: str, image_type: str = "output") -> str:
    return f"/api/images/{image_type}/{filename}"
