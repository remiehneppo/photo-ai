import base64
from io import BytesIO

from fastapi import HTTPException
from PIL import Image as PILImage, ImageChops, ImageStat, UnidentifiedImageError

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


def mask_bounds(mask_bytes: bytes) -> tuple[int, int, int, int] | None:
    """Return the bounding box of non-black mask pixels."""
    try:
        with PILImage.open(BytesIO(mask_bytes)) as img:
            return img.convert("L").point(lambda px: 255 if px > 8 else 0).getbbox()
    except UnidentifiedImageError:
        return None


def foreground_from_reference(reference_bytes: bytes, mask_b64: str | None = None) -> PILImage.Image:
    """Extract a transparent foreground from a reference image.

    Uses a provided SAM mask when available, otherwise preserves an existing alpha channel
    and finally falls back to a conservative border-color background estimate.
    """
    with PILImage.open(BytesIO(reference_bytes)) as source:
        rgba = source.convert("RGBA")
    alpha_bbox = rgba.getchannel("A").point(lambda px: 255 if px > 8 else 0).getbbox()
    if alpha_bbox and alpha_bbox != (0, 0, rgba.width, rgba.height):
        return rgba.crop(alpha_bbox)

    if mask_b64:
        try:
            mask_bytes = base64.b64decode(mask_b64, validate=True)
            with PILImage.open(BytesIO(mask_bytes)) as mask_img:
                mask = mask_img.convert("L").resize(rgba.size, PILImage.Resampling.LANCZOS)
            rgba.putalpha(mask.point(lambda px: 255 if px > 16 else 0))
            bbox = rgba.getchannel("A").getbbox()
            return rgba.crop(bbox) if bbox else rgba
        except Exception:
            pass

    mask = _border_background_alpha(rgba)
    rgba.putalpha(mask)
    bbox = rgba.getchannel("A").getbbox()
    return rgba.crop(bbox) if bbox else rgba


def composite_reference_into_mask(source_bytes: bytes, mask_bytes: bytes, reference_bytes: bytes, reference_mask_b64: str | None = None) -> bytes:
    """Paste extracted reference foreground into the selected mask area of source image."""
    with PILImage.open(BytesIO(source_bytes)) as src_img:
        source = src_img.convert("RGBA")
    selection = mask_bounds(mask_bytes)
    if not selection:
        raise HTTPException(status_code=400, detail="Mask must contain a selected area")

    left, top, right, bottom = selection
    box_width = max(1, right - left)
    box_height = max(1, bottom - top)
    foreground = foreground_from_reference(reference_bytes, reference_mask_b64)
    if foreground.width <= 0 or foreground.height <= 0:
        raise HTTPException(status_code=400, detail="Reference image could not be extracted")

    scale = min((box_width * 0.92) / foreground.width, (box_height * 0.92) / foreground.height)
    scale = max(scale, 1 / max(foreground.width, foreground.height))
    target_size = (
        max(1, int(foreground.width * scale)),
        max(1, int(foreground.height * scale)),
    )
    foreground = foreground.resize(target_size, PILImage.Resampling.LANCZOS)
    paste_x = left + (box_width - foreground.width) // 2
    paste_y = top + (box_height - foreground.height) // 2
    source.alpha_composite(foreground, (paste_x, paste_y))

    output = BytesIO()
    source.convert("RGB").save(output, format="PNG")
    return output.getvalue()


def _border_background_alpha(image: PILImage.Image, tolerance: int = 34) -> PILImage.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    
    # Sample pixels from the edges to estimate background color
    samples = []
    step = max(1, width // 50)
    for x in range(0, width, step):
        samples.append(rgb.getpixel((x, 0)))
        samples.append(rgb.getpixel((x, height - 1)))
    step_y = max(1, height // 50)
    for y in range(0, height, step_y):
        samples.append(rgb.getpixel((0, y)))
        samples.append(rgb.getpixel((width - 1, y)))
        
    if not samples:
        avg = (0, 0, 0)
    else:
        avg = tuple(int(sum(pixel[channel] for pixel in samples) / len(samples)) for channel in range(3))
    bg = PILImage.new("RGB", rgb.size, avg)
    diff = ImageChops.difference(rgb, bg)
    gray = diff.convert("L")
    stat = ImageStat.Stat(gray)
    threshold = max(tolerance, int(stat.mean[0] + stat.stddev[0] * 0.65))
    return gray.point(lambda px: 0 if px < threshold else 255)

