from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.image_utils import get_image_size, to_grayscale_png
from app.services.job_service import create_job, run_job, save_job_images
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.storage_service import save_upload
from app.services.upload_service import read_image_upload

router = APIRouter(prefix="/api/inpaint", tags=["inpaint"])


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
    seed: Optional[int] = Form(None),
    denoising_strength: Optional[float] = Form(None),
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
    source_width, source_height = get_image_size(image_bytes)
    mask_bytes = to_grayscale_png(await read_image_upload(mask))

    file_path, filename = await save_upload(image_bytes)
    preset = get_preset("inpaint", style)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="inpaint",
        style=style,
        user_prompt=prompt,
        total_steps=preset["steps"],
        estimated_seconds=50,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)
    b64_mask = a1111.encode_image(mask_bytes)

    async def task():
        model_choice = preset.get("model_candidates", preset["model"])
        checkpoint = await resolve_checkpoint(a1111, model_choice)
        model_meta = get_model_meta(checkpoint)
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "init_images": [b64_input],
            "mask": b64_mask,
            "mask_blur": preset.get("mask_blur", 4),
            "inpainting_fill": 1,
            "inpaint_full_res": inpaint_full_res,
            "inpaint_full_res_padding": preset.get("inpaint_full_res_padding", 32),
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
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        images, resolved_seed = await a1111.img2img(payload)
        img_bytes = a1111.decode_image(images[0])
        await save_job_images(job_id, user_id, [img_bytes], input_file_path=file_path, input_filename=filename, seed=resolved_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, cleanup_provider=a1111.cleanup_after_job)
    return JobResponse(job_id=job_id, status="pending")


@router.get("/styles")
async def get_inpaint_styles():
    return {"styles": available_styles("inpaint")}
