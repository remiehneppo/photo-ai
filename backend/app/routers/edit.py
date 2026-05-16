import uuid
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from PIL import Image as PILImage, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts
from app.services.job_service import run_job
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.storage_service import save_output, save_upload
from app.services.upload_service import read_image_upload, validate_image_bytes

router = APIRouter(prefix="/api/edit", tags=["edit"])


def get_image_size(image_bytes: bytes) -> tuple[int, int]:
    try:
        return validate_image_bytes(image_bytes)
    except HTTPException:
        raise
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is not a valid image file") from exc


def ensure_image_size(image_bytes: bytes, target_size: tuple[int, int]) -> bytes:
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


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def edit_image(
    background_tasks: BackgroundTasks,
    prompt: str = Form(...),
    style: str = Form("realistic"),
    fix_face: bool = Form(False),
    fix_hands: bool = Form(False),
    control_mode: str | None = Form(None),
    control_weight: float = Form(0.7),
    seed: Optional[int] = Form(None),
    denoising_strength: Optional[float] = Form(None),
    image: UploadFile = File(...),
    control_image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    valid_styles = available_styles("img2img")
    if style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    image_bytes = await read_image_upload(image)
    source_width, source_height = get_image_size(image_bytes)
    file_path, filename = await save_upload(image_bytes)
    controlnet = {}
    if control_image is not None and hasattr(control_image, "read"):
        reference_bytes = await read_image_upload(control_image)
        try:
            controlnet = await build_controlnet_scripts(a1111, a1111.encode_image(reference_bytes), control_mode or "edges", control_weight)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    preset = get_preset("img2img", style)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="img2img",
        style=style,
        user_prompt=prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=preset["steps"],
        estimated_seconds=75 if style == "advertisement" else 40,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        checkpoint = await resolve_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(preset["model"])
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "init_images": [b64_input],
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": denoising_strength if denoising_strength is not None else preset["denoising_strength"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": source_width,
            "height": source_height,
            "seed": seed if seed is not None else -1,
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        alwayson_scripts = merge_alwayson_scripts(controlnet, adetailer)
        if alwayson_scripts:
            payload["alwayson_scripts"] = alwayson_scripts
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        images, resolved_seed = await a1111.img2img(payload)
        img_bytes = ensure_image_size(a1111.decode_image(images[0]), (source_width, source_height))
        out_path, out_filename = await save_output(img_bytes)
        db2 = SessionLocal()
        try:
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="input", file_path=file_path, filename=filename))
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="output", file_path=out_path, filename=out_filename))
            job2 = db2.query(Job).filter(Job.id == job_id).first()
            if job2 and resolved_seed is not None:
                job2.seed = resolved_seed
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, a1111.offload_unused_models)
    return JobResponse(job_id=job_id, status="pending")
