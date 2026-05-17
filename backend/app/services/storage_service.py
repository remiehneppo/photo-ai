import os
import uuid
import aiofiles
from io import BytesIO
from pathlib import Path
from PIL import Image as PILImage, UnidentifiedImageError
from app.config import STORAGE_PATH

_FORMAT_TO_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


def _detect_suffix(image_bytes: bytes) -> str:
    try:
        with PILImage.open(BytesIO(image_bytes)) as img:
            return _FORMAT_TO_EXT.get(img.format or "", ".png")
    except (UnidentifiedImageError, OSError):
        return ".png"


def _ensure_dirs():
    Path(f"{STORAGE_PATH}/input").mkdir(parents=True, exist_ok=True)
    Path(f"{STORAGE_PATH}/output").mkdir(parents=True, exist_ok=True)


async def save_upload(image_bytes: bytes, suffix: str | None = None) -> tuple[str, str]:
    """Save uploaded image. Returns (file_path, filename)."""
    _ensure_dirs()
    if suffix is None:
        suffix = _detect_suffix(image_bytes)
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


def delete_image_file(file_path: str) -> None:
    """Delete a stored image if it is inside the configured storage directory."""
    if not file_path:
        return

    storage_root = Path(STORAGE_PATH).resolve()
    path = Path(file_path).resolve()
    try:
        path.relative_to(storage_root)
    except ValueError:
        return

    if path.is_file():
        path.unlink()
