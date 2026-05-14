import io
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from PIL import Image as PILImage
from PIL import ImageFilter
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.job_service import run_job, update_job_progress
from app.services.storage_service import save_output, save_upload

router = APIRouter(prefix="/api/sharpen", tags=["sharpen"])

SHARPEN_PRESETS = {
    "soft": {"radius": 1.0, "percent": 90, "threshold": 5},
    "default": {"radius": 1.4, "percent": 140, "threshold": 3},
    "strong": {"radius": 2.0, "percent": 220, "threshold": 2},
}


class JobResponse(BaseModel):
    job_id: str
    status: str


@router.post("", response_model=JobResponse)
async def sharpen_image(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mode: str = Form("default"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if mode not in SHARPEN_PRESETS:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Choose from: {list(SHARPEN_PRESETS)}")

    image_bytes = await image.read()
    file_path, filename = await save_upload(image_bytes)

    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="sharpen",
        style=mode,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=3,
        estimated_seconds=5,
        progress_label="Queued",
    )
    db.add(job)
    db.commit()
    job_id = job.id
    user_id = current_user.id
    preset = SHARPEN_PRESETS[mode]

    async def task():
        update_job_progress(job_id, progress_percent=20, current_step=1, progress_label="Loading image")
        img = PILImage.open(io.BytesIO(image_bytes))
        output_format = "PNG"
        if img.mode not in {"RGB", "RGBA"}:
            img = img.convert("RGB")

        update_job_progress(job_id, progress_percent=55, current_step=2, progress_label="Sharpening")
        sharpened = img.filter(
            ImageFilter.UnsharpMask(
                radius=preset["radius"],
                percent=preset["percent"],
                threshold=preset["threshold"],
            )
        )

        buf = io.BytesIO()
        sharpened.save(buf, format=output_format)
        out_path, out_filename = await save_output(buf.getvalue())

        update_job_progress(job_id, progress_percent=85, current_step=3, progress_label="Saving")
        db2 = SessionLocal()
        try:
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="input", file_path=file_path, filename=filename))
            db2.add(Image(id=str(uuid.uuid4()), job_id=job_id, user_id=user_id, type="output", file_path=out_path, filename=out_filename))
            db2.commit()
        finally:
            db2.close()

    background_tasks.add_task(run_job, job_id, task)
    return JobResponse(job_id=job_id, status="pending")
