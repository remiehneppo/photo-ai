from io import BytesIO

from fastapi import HTTPException
from PIL import Image as PILImage, UnidentifiedImageError

from app.services.upload_service import validate_image_bytes


def get_image_size(image_bytes: bytes) -> tuple[int, int]:
    """Return (width, height) of an image or raise HTTP 400."""
    try:
        return validate_image_bytes(image_bytes)
    except HTTPException:
        raise
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not a valid image file") from exc


def ensure_image_size(image_bytes: bytes, target_size: tuple[int, int]) -> bytes:
    """Resize image to target_size if it differs; return as PNG bytes."""
    try:
        with PILImage.open(BytesIO(image_bytes)) as img:
            if img.size == target_size:
                return image_bytes
            resized = img.resize(target_size, PILImage.Resampling.LANCZOS)
            output = BytesIO()
            resized.save(output, format="PNG")
            return output.getvalue()
    except UnidentifiedImageError:
        return image_bytes


def constrain_image_pixels(image_bytes: bytes, max_pixels: int) -> bytes:
    """Downscale an image to fit a max pixel budget, preserving aspect ratio."""
    if max_pixels <= 0:
        return image_bytes
    try:
        with PILImage.open(BytesIO(image_bytes)) as img:
            width, height = img.size
            if width * height <= max_pixels:
                return image_bytes
            scale = (max_pixels / float(width * height)) ** 0.5
            target = (max(64, int(width * scale)), max(64, int(height * scale)))
            resized = img.resize(target, PILImage.Resampling.LANCZOS)
            output = BytesIO()
            resized.save(output, format="PNG")
            return output.getvalue()
    except UnidentifiedImageError:
        return image_bytes


def to_grayscale_png(image_bytes: bytes) -> bytes:
    """Convert image to grayscale PNG (for masks). Returns original bytes if conversion fails."""
    try:
        with PILImage.open(BytesIO(image_bytes)) as img:
            if img.format == "PNG" and img.mode in ("L", "RGB", "RGBA"):
                return image_bytes
            converted = img.convert("L")
            out = BytesIO()
            converted.save(out, format="PNG")
            return out.getvalue()
    except UnidentifiedImageError:
        return image_bytes
