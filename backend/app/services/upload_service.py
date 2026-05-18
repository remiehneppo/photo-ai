from io import BytesIO

from fastapi import HTTPException, UploadFile, status
from PIL import Image as PILImage
from PIL import UnidentifiedImageError

from app.config import MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES

ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
PILImage.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


async def read_image_upload(upload: UploadFile) -> bytes:
    image_bytes = await upload.read()
    validate_image_bytes(image_bytes)
    return image_bytes


def validate_image_bytes(image_bytes: bytes) -> tuple[int, int]:
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Uploaded image is too large. Limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )

    try:
        with PILImage.open(BytesIO(image_bytes)) as image:
            image_format = image.format
            width, height = image.size
            if image_format not in ALLOWED_IMAGE_FORMATS:
                raise HTTPException(status_code=400, detail="Uploaded image must be PNG, JPEG, or WEBP")
            if width <= 0 or height <= 0:
                raise HTTPException(status_code=400, detail="Uploaded image has invalid dimensions")
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Uploaded image has too many pixels. Limit is {MAX_IMAGE_PIXELS}",
                )
            image.load()  # Fully decode after cheap bounds checks — raises on corrupt data
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not a valid image file") from exc

    return width, height
