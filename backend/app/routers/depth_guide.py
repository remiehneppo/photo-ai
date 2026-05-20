"""Depth-guided image generation via ControlNet depth_midas."""
from typing import Optional

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import available_styles, get_preset, merge_prompt, get_model_meta
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from app.services.controlnet_service import build_controlnet_scripts
from app.services.model_service import add_model_override, resolve_controlnet_checkpoint

router = APIRouter(prefix="/api/depth-guide", tags=["depth_guide"])


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def depth_guide(
    background_tasks: BackgroundTasks,
    reference_image: UploadFile = File(...),
    prompt: str = Form(...),
    style: str = Form("realistic"),
    controlnet_weight: float = Form(0.7),
    seed: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    styles = available_styles("txt2img")
    if style not in styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {styles}")

    try:
        preset = get_preset("txt2img", style)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_bytes = await read_image_upload(reference_image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="depth_guide",
        style=style,
        user_prompt=prompt,
        total_steps=preset.get("steps", 30),
        estimated_seconds=60,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        checkpoint = await resolve_controlnet_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(checkpoint)
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        cn_scripts = await build_controlnet_scripts(
            a1111,
            b64_input,
            "depth",
            weight=controlnet_weight,
            prefer_sdxl=model_meta.get("sd_version") == "XL",
        )
        payload = {
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "steps": preset.get("steps", 30),
            "cfg_scale": preset.get("cfg_scale", 7),
            "sampler_name": preset.get("sampler_name", "DPM++ 2M Karras"),
            "width": preset.get("width", 512),
            "height": preset.get("height", 512),
            "seed": seed if seed is not None else -1,
            "alwayson_scripts": cn_scripts,
        }
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        images, out_seed = await a1111.txt2img(payload)
        img_bytes = a1111.decode_image(images[0])
        await save_job_images(job_id, user_id, [img_bytes], input_file_path=file_path, input_filename=filename, seed=out_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, cleanup_provider=a1111.cleanup_after_job)
    return JobResponse(job_id=job_id, status="pending")
