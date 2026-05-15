import uuid
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.preset_service import available_upscale_modes, get_upscale_preset
from app.services.a1111_client import a1111
from app.services.storage_service import save_upload, save_output
from app.services.job_service import run_job
from app.services.upload_service import read_image_upload
from pydantic import BaseModel

router = APIRouter(prefix="/api/upscale", tags=["upscale"])


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def upscale_image(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mode: str = Form("default"),  # default | face_restore | anime
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        preset = get_upscale_preset(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Choose from: {available_upscale_modes()}") from exc

    image_bytes = await read_image_upload(image)
    file_path, filename = await save_upload(image_bytes)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="upscale",
        style=mode,
        status="pending",
        progress_percent=0,
        estimated_seconds=30,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id
    b64_input = a1111.encode_image(image_bytes)

    async def task():
        payload = {
            "image": b64_input,
            "upscaler_1": preset["upscaler_1"],
            "upscaling_resize": preset["upscaling_resize"],
            "gfpgan_visibility": preset.get("gfpgan_visibility", 0.0),
            "codeformer_visibility": preset.get("codeformer_visibility", 0.0),
        }
        b64_result = await a1111.upscale(payload)
        img_bytes = a1111.decode_image(b64_result)
        out_path, out_filename = await save_output(img_bytes)
        db2 = SessionLocal()
        try:
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="input", file_path=file_path, filename=filename))
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="output", file_path=out_path, filename=out_filename))
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task, a1111.get_progress)
    return JobResponse(job_id=job_id, status="pending")
