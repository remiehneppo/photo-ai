import io
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from PIL import Image as PILImage, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import OUTPAINT_MAX_PIXELS
from app.database import get_db
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.job_service import create_job, run_job, save_job_images
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.storage_service import save_upload
from app.services.upload_service import read_image_upload

router = APIRouter(prefix="/api/outpaint", tags=["outpaint"])

VALID_DIRECTIONS = ["left", "right", "top", "bottom", "all"]


class JobResponse(BaseModel):
    job_id: str
    status: str


def expand_canvas(img_bytes: bytes, direction: str, expand_px: int, max_pixels: int = OUTPAINT_MAX_PIXELS) -> tuple[bytes, bytes]:
    try:
        img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not a valid image file") from exc
    w, h = img.size

    if direction == "left":
        new_w, new_h = w + expand_px, h
        offset = (expand_px, 0)
    elif direction == "right":
        new_w, new_h = w + expand_px, h
        offset = (0, 0)
    elif direction == "top":
        new_w, new_h = w, h + expand_px
        offset = (0, expand_px)
    elif direction == "bottom":
        new_w, new_h = w, h + expand_px
        offset = (0, 0)
    else:  # all
        new_w, new_h = w + expand_px * 2, h + expand_px * 2
        offset = (expand_px, expand_px)

    expanded = PILImage.new("RGB", (new_w, new_h), (0, 0, 0))
    expanded.paste(img, offset)

    mask = PILImage.new("L", (new_w, new_h), 255)
    mask.paste(0, (offset[0], offset[1], offset[0] + w, offset[1] + h))

    if max_pixels > 0 and new_w * new_h > max_pixels:
        scale = (max_pixels / float(new_w * new_h)) ** 0.5
        resized_w = max(64, int(new_w * scale))
        resized_h = max(64, int(new_h * scale))
        expanded = expanded.resize((resized_w, resized_h), PILImage.Resampling.LANCZOS)
        mask = mask.resize((resized_w, resized_h), PILImage.Resampling.NEAREST)

    buf_img = io.BytesIO()
    expanded.save(buf_img, format="PNG")

    buf_mask = io.BytesIO()
    mask.save(buf_mask, format="PNG")

    return buf_img.getvalue(), buf_mask.getvalue()


@router.post("", response_model=JobResponse)
async def outpaint_image(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    direction: str = Form("all"),
    style: str = Form("realistic"),
    prompt: str = Form(""),
    fix_face: bool = Form(False),
    fix_hands: bool = Form(False),
    seed: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    valid_styles = available_styles("outpaint")
    if style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid direction. Choose from: {VALID_DIRECTIONS}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)

    preset = get_preset("outpaint", style)
    expand_px = preset.get("expand_pixels", 256)

    job = create_job(
        db,
        user_id=current_user.id,
        feature="outpaint",
        style=style,
        user_prompt=prompt,
        total_steps=preset["steps"],
        estimated_seconds=90 if style == "advertisement" else 50,
    )
    job_id = job.id
    user_id = current_user.id

    expanded_bytes, mask_bytes = expand_canvas(image_bytes, direction, expand_px)
    b64_expanded = a1111.encode_image(expanded_bytes)
    b64_mask = a1111.encode_image(mask_bytes)

    async def task():
        model_choice = preset.get("model_candidates", preset["model"])
        checkpoint = await resolve_checkpoint(a1111, model_choice)
        model_meta = get_model_meta(checkpoint)
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        with PILImage.open(io.BytesIO(expanded_bytes)) as expanded_image:
            expanded_width, expanded_height = expanded_image.size
        payload = {
            "init_images": [b64_expanded],
            "mask": b64_mask,
            "mask_blur": 8,
            "inpainting_fill": 1,
            "inpaint_full_res": False,
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": preset["denoising_strength"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": expanded_width,
            "height": expanded_height,
            "seed": seed if seed is not None else -1,
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        images, resolved_seed = await a1111.img2img(payload)
        img_bytes_out = a1111.decode_image(images[0])
        await save_job_images(job_id, user_id, [img_bytes_out], input_file_path=file_path, input_filename=filename, seed=resolved_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
