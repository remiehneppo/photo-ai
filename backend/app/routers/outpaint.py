import uuid
import io
from PIL import Image as PILImage
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.preset_service import get_preset, merge_prompt
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload, save_output
from app.services.job_service import run_job
from pydantic import BaseModel

router = APIRouter(prefix="/api/outpaint", tags=["outpaint"])

VALID_STYLES = ["realistic", "anime", "advertisement", "portrait", "artistic"]
VALID_DIRECTIONS = ["left", "right", "top", "bottom", "all"]


class JobResponse(BaseModel):
    job_id: str
    status: str


def expand_canvas(img_bytes: bytes, direction: str, expand_px: int) -> tuple[bytes, bytes]:
    """
    Expand the image canvas in the given direction.
    Returns (expanded_image_bytes, mask_bytes) where white=area to fill.
    """
    img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
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

    # Expanded image (original pasted, rest black)
    expanded = PILImage.new("RGB", (new_w, new_h), (0, 0, 0))
    expanded.paste(img, offset)

    # Mask: white = generate, black = keep
    mask = PILImage.new("L", (new_w, new_h), 255)  # all white
    mask.paste(0, (offset[0], offset[1], offset[0] + w, offset[1] + h))  # black on original area

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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if style not in VALID_STYLES:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {VALID_STYLES}")
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid direction. Choose from: {VALID_DIRECTIONS}")
    if (fix_face or fix_hands) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    image_bytes = await image.read()
    file_path, filename = await save_upload(image_bytes)

    preset = get_preset("outpaint", style)
    expand_px = preset.get("expand_pixels", 256)

    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="outpaint",
        style=style,
        user_prompt=prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=preset["steps"],
        estimated_seconds=90 if style == "advertisement" else 50,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id

    expanded_bytes, mask_bytes = expand_canvas(image_bytes, direction, expand_px)
    b64_expanded = a1111.encode_image(expanded_bytes)
    b64_mask = a1111.encode_image(mask_bytes)

    async def task():
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "init_images": [b64_expanded],
            "mask": b64_mask,
            "mask_blur": 8,
            "inpainting_fill": 1,  # fill
            "inpaint_full_res": False,
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": preset["denoising_strength"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
        }
        adetailer = build_adetailer_scripts(fix_face, fix_hands)
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        images = await a1111.img2img(payload)
        img_bytes_out = a1111.decode_image(images[0])
        out_path, out_filename = await save_output(img_bytes_out)
        db2 = SessionLocal()
        try:
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="input", file_path=file_path, filename=filename))
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="output", file_path=out_path, filename=out_filename))
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
