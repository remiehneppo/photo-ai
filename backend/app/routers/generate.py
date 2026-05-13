from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
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

    preset = get_preset("txt2img", req.style)
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        feature="txt2img",
        style=req.style,
        user_prompt=req.prompt,
        status="pending",
    )
    db.add(job)
    db.commit()
    job_id = job.id

    user_id = current_user.id

    async def task():
        from app.database import SessionLocal
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

    background_tasks.add_task(run_job, job_id, task)
    return JobResponse(job_id=job_id, status="pending")


@router.get("/styles")
def get_styles():
    return {"styles": VALID_STYLES}
