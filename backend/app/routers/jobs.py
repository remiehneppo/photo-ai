from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.job import Job
from app.models.image import Image
from app.services.auth_service import get_current_user
from app.services.storage_service import delete_image_file, get_image_url

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
    progress_percent: int
    current_step: Optional[int]
    total_steps: Optional[int]
    eta_seconds: Optional[int]
    estimated_seconds: Optional[int]
    progress_label: Optional[str]
    error_message: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    images: list[ImageOut]


@router.get("", response_model=list[JobDetail])
def list_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
):
    jobs = (
        db.query(Job)
        .filter(Job.user_id == current_user.id)
        .order_by(Job.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    images_by_job = _images_by_job(db, [job.id for job in jobs])
    return [_build_job_detail(job, db, images_by_job.get(job.id, [])) for job in jobs]


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


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in {"done", "failed"}:
        raise HTTPException(status_code=409, detail="Only completed or failed jobs can be deleted")

    images = db.query(Image).filter(Image.job_id == job.id, Image.user_id == current_user.id).all()
    file_paths = [image.file_path for image in images]
    for image in images:
        db.delete(image)
    db.delete(job)
    db.commit()
    for file_path in file_paths:
        delete_image_file(file_path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _build_job_detail(job: Job, db: Session, images: list[Image] | None = None) -> JobDetail:
    if images is None:
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
        progress_percent=job.progress_percent,
        current_step=job.current_step,
        total_steps=job.total_steps,
        eta_seconds=job.eta_seconds,
        estimated_seconds=job.estimated_seconds,
        progress_label=job.progress_label,
        error_message=job.error_message,
        created_at=job.created_at,
        completed_at=job.completed_at,
        images=image_outs,
    )


def _images_by_job(db: Session, job_ids: list[str]) -> dict[str, list[Image]]:
    if not job_ids:
        return {}
    rows = db.query(Image).filter(Image.job_id.in_(job_ids)).all()
    grouped: dict[str, list[Image]] = {job_id: [] for job_id in job_ids}
    for image in rows:
        grouped.setdefault(image.job_id, []).append(image)
    return grouped
