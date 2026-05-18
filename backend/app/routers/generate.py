from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.auth_service import get_current_user
from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts
from app.services.job_service import create_job, run_job, save_job_images
from app.services.model_service import add_model_override, resolve_checkpoint, resolve_controlnet_checkpoint
from app.services.preset_service import available_styles, get_model_meta, get_preset, merge_prompt
from app.services.upload_service import read_image_upload

router = APIRouter(prefix="/api/generate", tags=["generate"])

# Aspect ratio → (width, height) mapping
ASPECT_RATIO_MAP: dict[str, tuple[int, int]] = {
    "1:1": (512, 512),
    "4:3": (768, 576),
    "3:4": (576, 768),
    "16:9": (912, 512),
    "9:16": (512, 912),
    "3:2": (768, 512),
    "2:3": (512, 768),
}


class GenerateRequest(BaseModel):
    prompt: str
    style: str = "realistic"
    fix_face: bool = False
    fix_hands: bool = False
    seed: Optional[int] = None
    # G1 – resolution
    aspect_ratio: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    # G2 – negative prompt
    negative_prompt: Optional[str] = None
    # G3 – advanced params
    steps: Optional[int] = Field(default=None, ge=1, le=150)
    cfg_scale: Optional[float] = Field(default=None, ge=1.0, le=30.0)
    sampler_name: Optional[str] = None
    # G4 – batch
    batch_count: int = Field(default=1, ge=1, le=4)
    # I3 – tiling
    tiling: bool = False
    # H1 – checkpoint override
    checkpoint: Optional[str] = None


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def generate(
    req: GenerateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    valid_styles = available_styles("txt2img")
    if req.style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if (req.fix_face or req.fix_hands) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    preset = get_preset("txt2img", req.style)
    # G1 – resolution override
    out_width, out_height = _resolve_dimensions(req, preset)

    job = create_job(
        db,
        user_id=current_user.id,
        feature="txt2img",
        style=req.style,
        user_prompt=req.prompt,
        total_steps=req.steps or preset["steps"],
        estimated_seconds=90 if out_width >= 1024 or out_height >= 1024 else 45,
    )
    job_id = job.id
    user_id = current_user.id

    async def task():
        # H1 – checkpoint override
        if req.checkpoint:
            checkpoint = req.checkpoint
        else:
            checkpoint = await resolve_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(preset["model"])
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], req.prompt)
        # G2 – negative prompt
        negative = preset["base_negative"]
        if req.negative_prompt and req.negative_prompt.strip():
            negative = f"{req.negative_prompt.strip()}, {negative}"
        payload = {
            "prompt": positive,
            "negative_prompt": negative,
            "steps": req.steps if req.steps is not None else preset["steps"],
            "cfg_scale": req.cfg_scale if req.cfg_scale is not None else preset["cfg_scale"],
            "sampler_name": req.sampler_name if req.sampler_name else preset["sampler_name"],
            "width": out_width,
            "height": out_height,
            "seed": req.seed if req.seed is not None else -1,
            "tiling": req.tiling,  # I3
        }
        adetailer = build_adetailer_scripts(req.fix_face, req.fix_hands)
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        # G4 – batch
        all_images: list[bytes] = []
        last_seed = None
        for _ in range(req.batch_count):
            images, seed = await a1111.txt2img(payload)
            all_images.append(a1111.decode_image(images[0]))
            if last_seed is None:
                last_seed = seed
            payload["seed"] = -1  # different seed for subsequent images
        await save_job_images(job_id, user_id, all_images, seed=last_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")


@router.post("/reference", response_model=JobResponse)
async def generate_with_reference(
    background_tasks: BackgroundTasks,
    prompt: str = Form(...),
    style: str = Form("realistic"),
    control_mode: str = Form("edges"),
    control_weight: float = Form(0.7),
    fix_face: bool = Form(False),
    fix_hands: bool = Form(False),
    seed: Optional[int] = Form(None),
    control_image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    valid_styles = available_styles("txt2img")
    if style not in valid_styles:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {valid_styles}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    reference_bytes = await read_image_upload(control_image)
    b64_reference = a1111.encode_image(reference_bytes)
    try:
        controlnet = await build_controlnet_scripts(a1111, b64_reference, control_mode, control_weight)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preset = get_preset("txt2img", style)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="txt2img",
        style=style,
        user_prompt=prompt,
        total_steps=preset["steps"],
        estimated_seconds=100 if preset["width"] >= 1024 or preset["height"] >= 1024 else 55,
    )
    job_id = job.id
    user_id = current_user.id

    async def task():
        checkpoint = await resolve_controlnet_checkpoint(a1111, preset["model"])
        model_meta = get_model_meta(preset["model"])
        await a1111.load_checkpoint(checkpoint)
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": preset["width"],
            "height": preset["height"],
            "seed": seed if seed is not None else -1,
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        alwayson_scripts = merge_alwayson_scripts(controlnet, adetailer)
        if alwayson_scripts:
            payload["alwayson_scripts"] = alwayson_scripts
        payload = add_model_override(payload, checkpoint, model_meta.get("clip_skip"))
        images, resolved_seed = await a1111.txt2img(payload)
        img_bytes = a1111.decode_image(images[0])
        await save_job_images(job_id, user_id, [img_bytes], seed=resolved_seed)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")


@router.get("/styles")
def get_styles():
    return {"styles": available_styles("txt2img")}


class EnhancePromptRequest(BaseModel):
    prompt: str
    style: str = "realistic"


@router.post("/enhance-prompt")
def enhance_prompt(req: EnhancePromptRequest):
    """I2 – Prompt Enhancer: enriches a bare prompt with quality/style tags from the preset."""
    try:
        preset = get_preset("txt2img", req.style)
    except ValueError:
        return {"prompt": req.prompt}

    base_positive = preset.get("base_positive", "")
    if not req.prompt.strip():
        return {"prompt": base_positive}

    # Prepend user prompt so it takes priority, then append quality tags
    enhanced = merge_prompt(base_positive, req.prompt)
    return {"prompt": enhanced}


def _resolve_dimensions(req: GenerateRequest, preset: dict) -> tuple[int, int]:
    """Return (width, height) honouring aspect_ratio > explicit w/h > preset."""
    if req.aspect_ratio and req.aspect_ratio in ASPECT_RATIO_MAP:
        return ASPECT_RATIO_MAP[req.aspect_ratio]
    if req.width and req.height:
        return int(req.width), int(req.height)
    return int(preset["width"]), int(preset["height"])
