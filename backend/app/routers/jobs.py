from datetime import datetime
from typing import AsyncGenerator, Optional
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.services.a1111_client import a1111
from app.services.auth_service import get_current_user
from app.services.job_service import get_current_job_id
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
    seed: Optional[int]
    created_at: datetime
    completed_at: Optional[datetime]
    images: list[ImageOut]


class JobListResponse(BaseModel):
    total: int
    items: list[JobDetail]


@router.get("", response_model=JobListResponse)
def list_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    feature: Optional[str] = Query(None),
):
    # When called directly (not via HTTP), FastAPI Query defaults arrive as FieldInfo objects
    from fastapi.params import Query as QueryType
    if isinstance(feature, QueryType):
        feature = None
    if isinstance(skip, QueryType):
        skip = 0
    if isinstance(limit, QueryType):
        limit = 20
    return _list_jobs(db=db, current_user=current_user, skip=skip, limit=limit, feature=feature)


def _list_jobs(
    db: Session,
    current_user: User,
    *,
    skip: int = 0,
    limit: int = 20,
    feature: str | None = None,
) -> JobListResponse:
    query = db.query(Job).filter(Job.user_id == current_user.id)
    if feature:
        query = query.filter(Job.feature == feature)
    total = query.count()
    jobs = query.order_by(Job.created_at.desc()).offset(skip).limit(limit).all()
    images_by_job = _images_by_job(db, [job.id for job in jobs])
    items = [_build_job_detail(job, db, images_by_job.get(job.id, [])) for job in jobs]
    return JobListResponse(total=total, items=items)


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


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in {"pending", "processing"}:
        raise HTTPException(status_code=409, detail="Only pending or processing jobs can be cancelled")

    # Only interrupt A1111 if this job is the one currently running
    if job.status == "processing" and get_current_job_id() == job_id:
        await a1111.interrupt()

    job.status = "failed"
    job.error_message = "Cancelled by user"
    job.progress_label = "Cancelled"
    job.completed_at = datetime.utcnow()
    db.commit()
    return {"status": "cancelled"}


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


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            db.expire_all()
            j = db.query(Job).filter(Job.id == job_id).first()
            if j is None:
                break
            images = db.query(Image).filter(Image.job_id == j.id).all()
            detail = _build_job_detail(j, db, images)
            data = detail.model_dump(mode="json")
            yield f"data: {json.dumps(data)}\n\n"
            if j.status in ("done", "failed"):
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
        seed=job.seed,
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
