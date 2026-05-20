from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import get_preset, available_styles, merge_prompt
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import get_model_meta
from pydantic import BaseModel

router = APIRouter(prefix="/api/variations", tags=["variations"])


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def create_variations(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    style: str = Form("realistic"),
    prompt: Optional[str] = Form(None),
    denoising_strength: float = Form(0.3),
    num_variations: int = Form(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not 0.1 <= denoising_strength <= 0.5:
        raise HTTPException(status_code=400, detail="denoising_strength must be 0.1–0.5")
    if not 1 <= num_variations <= 4:
        raise HTTPException(status_code=400, detail="num_variations must be 1–4")

    styles = available_styles("img2img")
    if style not in styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {styles}")

    try:
        preset = get_preset("img2img", style)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="variations",
        style=style,
        user_prompt=prompt,
        estimated_seconds=30 * num_variations,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        checkpoint = await resolve_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(preset["model"])
        await a1111.load_checkpoint(checkpoint)
        positive_prompt = merge_prompt(preset["base_positive"], prompt or "")
        payload = {
            "init_images": [b64_input],
            "prompt": positive_prompt,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": denoising_strength,
            "steps": preset.get("steps", 25),
            "cfg_scale": preset.get("cfg_scale", 7),
            "sampler_name": preset.get("sampler_name", "DPM++ 2M Karras"),
            "batch_size": num_variations,
            "seed": -1,
        }
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        b64_list, seed = await a1111.img2img(payload)
        output_bytes_list = [a1111.decode_image(b) for b in b64_list]
        await save_job_images(
            job_id, user_id, output_bytes_list,
            input_file_path=file_path, input_filename=filename, seed=seed
        )

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, cleanup_provider=a1111.cleanup_after_job)
    return JobResponse(job_id=job_id, status="pending")
