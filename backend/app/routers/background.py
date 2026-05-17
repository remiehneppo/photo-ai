"""Background remove & replace using SAM (inpaint-anything) + A1111 inpainting."""
from typing import List, Optional

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import get_preset, merge_prompt
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import get_model_meta

router = APIRouter(prefix="/api/background", tags=["background"])

DEFAULT_SAM_MODEL = "sam_vit_h_4b8939.pth"


class SegmentRequest(BaseModel):
    point_x: float
    point_y: float
    point_label: int = 1  # 1=foreground, 0=background


class SegmentResponse(BaseModel):
    mask_b64: str


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("/segment", response_model=SegmentResponse)
async def segment_subject(
    image: UploadFile = File(...),
    point_x: float = Form(...),
    point_y: float = Form(...),
    point_label: int = Form(1),
    current_user: User = Depends(get_current_user),
):
    """Click on a point to get a segmentation mask via SAM."""
    if not await a1111.sam_heartbeat():
        raise HTTPException(status_code=503, detail="SAM (inpaint-anything) extension not available")

    image_bytes = await read_image_upload(image)
    b64_input = a1111.encode_image(image_bytes)

    payload = {
        "input_image": b64_input,
        "sam_model_name": DEFAULT_SAM_MODEL,
        "point_coords": [[point_x, point_y]],
        "point_labels": [point_label],
        "dilate_mask_padding": 10,
    }
    result = await a1111.sam_predict(payload)
    masks = result.get("masks", [])
    if not masks:
        raise HTTPException(status_code=422, detail="SAM returned no masks")
    # Return the first (best) mask
    return SegmentResponse(mask_b64=masks[0])


@router.post("/replace", response_model=JobResponse)
async def replace_background(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mask_b64: str = Form(...),
    background_prompt: str = Form(...),
    style: str = Form("realistic"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace background using inpainting with provided mask (from /segment)."""
    try:
        preset = get_preset("inpaint", style)
    except (ValueError, KeyError):
        try:
            preset = get_preset("img2img", style)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="background",
        style=style,
        user_prompt=background_prompt,
        estimated_seconds=60,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        checkpoint = await resolve_checkpoint(a1111, preset.get("model", "realismIllustriousBy_v55FP16"))
        model_meta = get_model_meta(preset.get("model", "realismIllustriousBy_v55FP16"))
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset.get("base_positive", ""), background_prompt)
        payload = {
            "init_images": [b64_input],
            "mask": mask_b64,
            "prompt": positive,
            "negative_prompt": preset.get("base_negative", ""),
            "denoising_strength": preset.get("denoising_strength", 0.85),
            "steps": preset.get("steps", 30),
            "cfg_scale": preset.get("cfg_scale", 7),
            "sampler_name": preset.get("sampler_name", "DPM++ 2M Karras"),
            "inpainting_fill": 1,  # original
            "inpaint_full_res": True,
            "seed": -1,
        }
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        b64_list, seed = await a1111.img2img(payload)
        output_bytes = a1111.decode_image(b64_list[0])
        await save_job_images(job_id, user_id, [output_bytes], input_file_path=file_path, input_filename=filename, seed=seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, a1111.offload_unused_models)
    return JobResponse(job_id=job_id, status="pending")
