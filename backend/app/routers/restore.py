"""Old photo restoration pipeline: upscale → face restore → img2img denoise."""
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import RESTORE_MAX_PIXELS
from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import get_restore_preset, merge_prompt
from app.services.a1111_client import a1111
from app.services.image_utils import constrain_image_pixels
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import get_model_meta

router = APIRouter(prefix="/api/restore", tags=["restore"])


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def restore_photo(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mode: str = Form("default"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        preset = get_restore_preset(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="restore",
        style=mode,
        estimated_seconds=90,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        # Step 1: Upscale + face restore via extra-single-image
        upscale_payload = {
            "image": b64_input,
            "upscaler_1": preset.get("upscaler_1", "R-ESRGAN 4x+"),
            "upscaling_resize": preset.get("upscaling_resize", 4),
            "gfpgan_visibility": preset.get("gfpgan_visibility", 0.7),
            "codeformer_visibility": preset.get("codeformer_visibility", 0.0),
        }
        b64_upscaled = await a1111.upscale(upscale_payload)
        upscaled_bytes = constrain_image_pixels(a1111.decode_image(b64_upscaled), RESTORE_MAX_PIXELS)

        # Step 2: img2img denoise for cleanup
        checkpoint = await resolve_checkpoint(a1111, preset.get("model", "realismIllustriousBy_v55FP16"))
        model_meta = get_model_meta(preset.get("model", "realismIllustriousBy_v55FP16"))
        await a1111.load_checkpoint(checkpoint)

        positive = merge_prompt(preset.get("base_positive", ""), "")
        b64_clean = a1111.encode_image(upscaled_bytes)
        img2img_payload = {
            "init_images": [b64_clean],
            "prompt": positive,
            "negative_prompt": preset.get("base_negative", ""),
            "denoising_strength": preset.get("denoising_strength", 0.3),
            "steps": preset.get("steps", 25),
            "cfg_scale": preset.get("cfg_scale", 7),
            "sampler_name": preset.get("sampler_name", "DPM++ 2M Karras"),
            "seed": -1,
        }
        img2img_payload = add_model_override(img2img_payload, checkpoint, model_meta.get("clip_skip"))
        b64_list, seed = await a1111.img2img(img2img_payload)
        output_bytes = a1111.decode_image(b64_list[0])
        await save_job_images(job_id, user_id, [output_bytes], input_file_path=file_path, input_filename=filename, seed=seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
