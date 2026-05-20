from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts, validate_controlnet_mode
from app.services.image_utils import ensure_image_size, get_image_size
from app.services.job_service import create_job, run_job, save_job_images
from app.services.model_service import add_model_override, resolve_checkpoint, resolve_controlnet_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.storage_service import save_upload
from app.services.upload_service import read_image_upload

router = APIRouter(prefix="/api/edit", tags=["edit"])


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
    negative_prompt: Optional[str] = Form(None),
    steps: Optional[int] = Form(None),
    cfg_scale: Optional[float] = Form(None),
    sampler_name: Optional[str] = Form(None),
    tiling: bool = Form(False),
    checkpoint: Optional[str] = Form(None),
    image: UploadFile = File(...),
    control_image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    # Guard: when called directly in tests, Form defaults arrive as FieldInfo objects
    from fastapi.params import Form as FormType
    if isinstance(negative_prompt, FormType):
        negative_prompt = None
    if isinstance(steps, FormType):
        steps = None
    if isinstance(cfg_scale, FormType):
        cfg_scale = None
    if isinstance(sampler_name, FormType):
        sampler_name = None
    if isinstance(tiling, FormType):
        tiling = False
    if isinstance(checkpoint, FormType):
        checkpoint = None
    valid_styles = available_styles("img2img")
    if style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    image_bytes = await read_image_upload(image)
    source_width, source_height = get_image_size(image_bytes)
    file_path, filename = await save_upload(image_bytes)
    control_reference_b64 = None
    control_mode_value = control_mode or "edges"
    if control_image is not None and hasattr(control_image, "read"):
        reference_bytes = await read_image_upload(control_image)
        control_reference_b64 = a1111.encode_image(reference_bytes)
        try:
            validate_controlnet_mode(control_mode_value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    preset = get_preset("img2img", style)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="img2img",
        style=style,
        user_prompt=prompt,
        total_steps=preset["steps"],
        estimated_seconds=75 if style == "advertisement" else 40,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        # H1 – checkpoint override
        if checkpoint:
            resolved_checkpoint = checkpoint
        elif control_reference_b64:
            resolved_checkpoint = await resolve_controlnet_checkpoint(a1111, preset["model"])
        else:
            resolved_checkpoint = await resolve_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(resolved_checkpoint)
        await a1111.load_checkpoint(resolved_checkpoint)
        controlnet = {}
        if control_reference_b64:
            controlnet = await build_controlnet_scripts(
                a1111,
                control_reference_b64,
                control_mode_value,
                control_weight,
                prefer_sdxl=model_meta.get("sd_version") == "XL",
            )
        positive = merge_prompt(preset["base_positive"], prompt)
        # G2 – negative prompt
        negative = preset["base_negative"]
        if negative_prompt and negative_prompt.strip():
            negative = f"{negative_prompt.strip()}, {negative}"
        payload = {
            "init_images": [b64_input],
            "prompt": positive,
            "negative_prompt": negative,
            "denoising_strength": denoising_strength if denoising_strength is not None else preset["denoising_strength"],
            "steps": steps if steps is not None else preset["steps"],
            "cfg_scale": cfg_scale if cfg_scale is not None else preset["cfg_scale"],
            "sampler_name": sampler_name if sampler_name else preset["sampler_name"],
            "width": source_width,
            "height": source_height,
            "seed": seed if seed is not None else -1,
            "tiling": tiling,  # I3
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        alwayson_scripts = merge_alwayson_scripts(controlnet, adetailer)
        if alwayson_scripts:
            payload["alwayson_scripts"] = alwayson_scripts
        payload = add_model_override(payload, resolved_checkpoint, model_meta.get("clip_skip"))
        images, resolved_seed = await a1111.img2img(payload)
        img_bytes = ensure_image_size(a1111.decode_image(images[0]), (source_width, source_height))
        await save_job_images(job_id, user_id, [img_bytes], input_file_path=file_path, input_filename=filename, seed=resolved_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress, cleanup_provider=a1111.cleanup_after_job)
    return JobResponse(job_id=job_id, status="pending")
