import uuid
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from PIL import Image as PILImage, UnidentifiedImageError
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import available_styles, get_preset, merge_prompt
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload, save_output
from app.services.job_service import run_job
from app.services.upload_service import read_image_upload, validate_image_bytes
from pydantic import BaseModel

router = APIRouter(prefix="/api/inpaint", tags=["inpaint"])


def _get_image_size(image_bytes: bytes) -> tuple[int, int]:
    try:
        return validate_image_bytes(image_bytes)
    except HTTPException:
        raise
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not a valid image file") from exc


def _ensure_png(image_bytes: bytes) -> bytes:
    """Convert mask to RGBA PNG so A1111 reads it consistently."""
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


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def inpaint_image(
    background_tasks: BackgroundTasks,
    prompt: str = Form(...),
    style: str = Form("realistic"),
    fix_face: bool = Form(False),
    fix_hands: bool = Form(False),
    inpaint_full_res: bool = Form(True),
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    valid_styles = available_styles("inpaint")
    if style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    image_bytes = await read_image_upload(image)
    source_width, source_height = _get_image_size(image_bytes)
    mask_bytes = _ensure_png(await read_image_upload(mask))

    file_path, filename = await save_upload(image_bytes)
    preset = get_preset("inpaint", style)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="inpaint",
        style=style,
        user_prompt=prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=preset["steps"],
        estimated_seconds=50,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)
    b64_mask = a1111.encode_image(mask_bytes)

    async def task():
        checkpoint = await resolve_checkpoint(a1111, preset["model"])
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "init_images": [b64_input],
            "mask": b64_mask,
            "mask_blur": preset.get("mask_blur", 4),
            "inpainting_fill": 1,  # original — preserves context outside mask
            "inpaint_full_res": inpaint_full_res,
            "inpaint_full_res_padding": preset.get("inpaint_full_res_padding", 32),
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": preset["denoising_strength"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": source_width,
            "height": source_height,
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        payload = add_model_override(payload, checkpoint)
        images = await a1111.img2img(payload)
        img_bytes = a1111.decode_image(images[0])
        out_path, out_filename = await save_output(img_bytes)
        db2 = SessionLocal()
        try:
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="input", file_path=file_path, filename=filename))
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="output", file_path=out_path, filename=out_filename))
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, a1111.offload_unused_models)
    return JobResponse(job_id=job_id, status="pending")


@router.get("/styles")
async def get_inpaint_styles():
    return {"styles": available_styles("inpaint")}
