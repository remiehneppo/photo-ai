import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.storage_service import get_image_url

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class ImageOut(BaseModel):
    id: str
    type: str
    url: str
    filename: Optional[str]


class JobDetail(BaseModel):
    id: str
    feature: str
    style: Optional[str]
    user_prompt: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    images: list[ImageOut]


@router.get("", response_model=list[JobDetail])
def list_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 20,
):
    jobs = (
        db.query(Job)
        .filter(Job.user_id == current_user.id)
        .order_by(Job.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_build_job_detail(job, db) for job in jobs]


@router.get("/{job_id}", response_model=JobDetail)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _build_job_detail(job, db)


def _build_job_detail(job: Job, db: Session) -> JobDetail:
    images = db.query(Image).filter(Image.job_id == job.id).all()
    image_outs = [
        ImageOut(
            id=img.id,
            type=img.type,
            url=get_image_url(img.filename, img.type) if img.filename else "",
            filename=img.filename,
        )
        for img in images
    ]
    return JobDetail(
        id=job.id,
        feature=job.feature,
        style=job.style,
        user_prompt=job.user_prompt,
        status=job.status,
        error_message=job.error_message,
        created_at=job.created_at,
        completed_at=job.completed_at,
        images=image_outs,
    )
