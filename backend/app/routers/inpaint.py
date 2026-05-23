from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.image_utils import composite_reference_into_mask, get_image_size, to_grayscale_png
from app.services.job_service import create_job, run_job, save_job_images
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.storage_service import delete_image_file, save_upload
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
    reference_image: UploadFile | None = File(None),
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

    seed_value = seed if isinstance(seed, int) else None
    denoising_value = denoising_strength if isinstance(denoising_strength, (int, float)) else None

    image_bytes = await read_image_upload(image)
    source_width, source_height = get_image_size(image_bytes)
    mask_bytes = to_grayscale_png(await read_image_upload(mask))
    reference_bytes = await read_image_upload(reference_image) if reference_image else None

    file_path, filename = await save_upload(image_bytes)
    preset = get_preset("inpaint", style)
    try:
        job = create_job(
            db,
            user_id=current_user.id,
            feature="inpaint",
            style=style,
            user_prompt=prompt,
            total_steps=preset["steps"],
            estimated_seconds=50,
        )
    except Exception:
        delete_image_file(file_path)
        raise
    job_id = job.id
    user_id = current_user.id
    b64_mask = a1111.encode_image(mask_bytes)

    async def task():
        model_choice = preset.get("model_candidates", preset["model"])
        checkpoint = await resolve_checkpoint(a1111, model_choice)
        model_meta = get_model_meta(checkpoint)
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        init_bytes = image_bytes
        effective_denoising = denoising_value if denoising_value is not None else preset["denoising_strength"]
        if reference_bytes is not None:
            reference_mask_b64 = await _reference_foreground_mask(reference_bytes)
            init_bytes = composite_reference_into_mask(image_bytes, mask_bytes, reference_bytes, reference_mask_b64)
            preset_denoising = float(preset.get("denoising_strength", 0.75))
            effective_denoising = denoising_value if denoising_value is not None else max(0.58, min(0.76, preset_denoising))
            positive = merge_prompt(
                positive,
                "integrate the referenced subject into the selected area, match scene perspective, lighting, shadows, and contact edges",
            )
        payload = {
            "init_images": [a1111.encode_image(init_bytes)],
            "mask": b64_mask,
            "mask_blur": preset.get("mask_blur", 4),
            "inpainting_fill": 1,
            "inpaint_full_res": inpaint_full_res,
            "inpaint_full_res_padding": preset.get("inpaint_full_res_padding", 32),
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "denoising_strength": effective_denoising,
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": source_width,
            "height": source_height,
            "seed": seed_value if seed_value is not None else -1,
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


async def _reference_foreground_mask(reference_bytes: bytes) -> str | None:
    if not await a1111.sam_heartbeat():
        return None
    try:
        width, height = get_image_size(reference_bytes)
        payload = {
            "input_image": a1111.encode_image(reference_bytes),
            "sam_model_name": (await a1111.get_sam_models())[0],
            "sam_positive_points": [[width / 2, height / 2]],
            "sam_negative_points": [],
        }
        result = await a1111.sam_predict(payload)
    except Exception as e:
        import logging
        logging.getLogger("app.routers.inpaint").exception("Failed to predict SAM mask for reference image")
        return None
    masks = result.get("masks", []) if isinstance(result, dict) else []
    return masks[0] if masks else None


@router.get("/styles")
async def get_inpaint_styles():
    return {"styles": available_styles("inpaint")}
