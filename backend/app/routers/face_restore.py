from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.preset_service import get_face_restore_preset
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload
from app.services.job_service import create_job, run_job, save_job_images
from app.services.upload_service import read_image_upload
from pydantic import BaseModel

router = APIRouter(prefix="/api/face-restore", tags=["face_restore"])

VALID_MODES = ["gfpgan", "codeformer", "combined"]


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def face_restore(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mode: str = Form("gfpgan"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Choose from: {VALID_MODES}")

    try:
        preset = get_face_restore_preset(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = create_job(
        db,
        user_id=current_user.id,
        feature="face_restore",
        style=mode,
        estimated_seconds=20,
    )
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        payload = {
            "image": b64_input,
            "upscaler_1": preset.get("upscaler_1", "None"),
            "upscaling_resize": preset.get("upscaling_resize", 1),
            "gfpgan_visibility": preset.get("gfpgan_visibility", 0.0),
            "codeformer_visibility": preset.get("codeformer_visibility", 0.0),
            "codeformer_weight": preset.get("codeformer_weight", 0.5),
        }
        b64_result = await a1111.upscale(payload)
        img_bytes = a1111.decode_image(b64_result)
        await save_job_images(job_id, user_id, [img_bytes], input_file_path=file_path, input_filename=filename)

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
