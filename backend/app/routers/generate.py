from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.adetailer_service import build_adetailer_scripts, has_adetailer
from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts
from app.services.model_service import add_model_override, resolve_checkpoint
from app.services.preset_service import get_preset, merge_prompt, available_styles
from app.services.a1111_client import a1111
from app.services.storage_service import save_output, get_image_url
from app.services.job_service import run_job
import uuid

router = APIRouter(prefix="/api/generate", tags=["generate"])

VALID_STYLES = ["realistic", "anime", "advertisement", "portrait", "artistic"]


class GenerateRequest(BaseModel):
    prompt: str
    style: str = "realistic"
    fix_face: bool = False
    fix_hands: bool = False


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
    if req.style not in VALID_STYLES:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {VALID_STYLES}")
    if (req.fix_face or req.fix_hands) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    preset = get_preset("txt2img", req.style)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="txt2img",
        style=req.style,
        user_prompt=req.prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=preset["steps"],
        estimated_seconds=90 if preset["width"] >= 1024 or preset["height"] >= 1024 else 45,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id

    user_id = current_user.id

    async def task():
        from app.database import SessionLocal
        checkpoint = await resolve_checkpoint(a1111, preset["model"])
        positive = merge_prompt(preset["base_positive"], req.prompt)
        payload = {
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": preset["width"],
            "height": preset["height"],
        }
        adetailer = build_adetailer_scripts(req.fix_face, req.fix_hands)
        if adetailer:
            payload["alwayson_scripts"] = adetailer
        payload = add_model_override(payload, checkpoint)
        images = await a1111.txt2img(payload)
        img_bytes = a1111.decode_image(images[0])
        file_path, filename = await save_output(img_bytes)
        db2 = SessionLocal()
        try:
            image = Image(
                id=str(uuid.uuid4()),
                job_id=job_id,
                user_id=user_id,
                type="output",
                file_path=file_path,
                filename=filename,
            )
            db2.add(image)
            db2.commit()
        finally:
            db2.close()

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
    control_image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fix_face_enabled = fix_face is True
    fix_hands_enabled = fix_hands is True
    if style not in VALID_STYLES:
        raise HTTPException(status_code=400, detail=f"Invalid style. Choose from: {VALID_STYLES}")
    if (fix_face_enabled or fix_hands_enabled) and not await has_adetailer(a1111):
        raise HTTPException(status_code=400, detail="ADetailer is not available in A1111")

    reference_bytes = await control_image.read()
    b64_reference = a1111.encode_image(reference_bytes)
    try:
        controlnet = await build_controlnet_scripts(a1111, b64_reference, control_mode, control_weight)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preset = get_preset("txt2img", style)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="txt2img",
        style=style,
        user_prompt=prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=preset["steps"],
        estimated_seconds=100 if preset["width"] >= 1024 or preset["height"] >= 1024 else 55,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id

    async def task():
        from app.database import SessionLocal
        checkpoint = await resolve_checkpoint(a1111, preset["model"])
        positive = merge_prompt(preset["base_positive"], prompt)
        payload = {
            "prompt": positive,
            "negative_prompt": preset["base_negative"],
            "steps": preset["steps"],
            "cfg_scale": preset["cfg_scale"],
            "sampler_name": preset["sampler_name"],
            "width": preset["width"],
            "height": preset["height"],
        }
        adetailer = build_adetailer_scripts(fix_face_enabled, fix_hands_enabled)
        alwayson_scripts = merge_alwayson_scripts(controlnet, adetailer)
        if alwayson_scripts:
            payload["alwayson_scripts"] = alwayson_scripts
        payload = add_model_override(payload, checkpoint)
        images = await a1111.txt2img(payload)
        img_bytes = a1111.decode_image(images[0])
        file_path, filename = await save_output(img_bytes)
        db2 = SessionLocal()
        try:
            image = Image(
                id=str(uuid.uuid4()),
                job_id=job_id,
                user_id=user_id,
                type="output",
                file_path=file_path,
                filename=filename,
            )
            db2.add(image)
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")


@router.get("/styles")
def get_styles():
    return {"styles": VALID_STYLES}
