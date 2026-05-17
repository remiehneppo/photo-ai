import asyncio
import logging
import time
from datetime import datetime
from typing import Awaitable, Callable, Any
from sqlalchemy.orm import Session
from app.models.job import Job
from app.models.image import Image
from app.database import SessionLocal

logger = logging.getLogger("photo_ai.jobs")

ProgressProvider = Callable[[], Awaitable[dict[str, Any]]]
PrepareProvider = Callable[[], Awaitable[None]]
_a1111_job_lock = asyncio.Lock()
_current_job_id: str | None = None

MAX_CONCURRENT_JOBS_PER_USER = 2


def count_active_jobs(db: Session, user_id: str) -> int:
    """Count pending/processing jobs for a user."""
    return db.query(Job).filter(
        Job.user_id == user_id,
        Job.status.in_(["pending", "processing"]),
    ).count()


def create_job(
    db: Session,
    user_id: str,
    feature: str,
    style: str | None = None,
    user_prompt: str | None = None,
    total_steps: int | None = None,
    estimated_seconds: int = 45,
    progress_label: str = "Queued",
) -> Job:
    """Create and persist a new Job. Raises HTTP 429 if user exceeds concurrent job limit."""
    import uuid
    from fastapi import HTTPException

    active = count_active_jobs(db, user_id)
    if active >= MAX_CONCURRENT_JOBS_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"Too many active jobs. Maximum {MAX_CONCURRENT_JOBS_PER_USER} concurrent jobs allowed.",
        )

    job = Job(
        id=str(uuid.uuid4()),
        user_id=user_id,
        feature=feature,
        style=style,
        user_prompt=user_prompt,
        status="pending",
        progress_percent=0,
        current_step=0,
        total_steps=total_steps,
        estimated_seconds=estimated_seconds,
        progress_label=progress_label,
    )
    db.add(job)
    db.commit()
    return job


async def save_job_images(
    job_id: str,
    user_id: str,
    output_bytes_list: list[bytes],
    input_file_path: str | None = None,
    input_filename: str | None = None,
    seed: int | None = None,
) -> None:
    """Save output images and optional input image reference to DB."""
    from app.services.storage_service import save_output

    db: Session = SessionLocal()
    try:
        if input_file_path and input_filename:
            db.add(Image(
                id=_new_id(),
                job_id=job_id,
                user_id=user_id,
                type="input",
                file_path=input_file_path,
                filename=input_filename,
            ))
        for img_bytes in output_bytes_list:
            out_path, out_filename = await save_output(img_bytes)
            db.add(Image(
                id=_new_id(),
                job_id=job_id,
                user_id=user_id,
                type="output",
                file_path=out_path,
                filename=out_filename,
            ))
        if seed is not None:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.seed = seed
        db.commit()
    finally:
        db.close()


def _new_id() -> str:
    import uuid
    return str(uuid.uuid4())



async def run_job(
    job_id: str,
    task_fn: Callable[[], Any],
    progress_provider: ProgressProvider | None = None,
    prepare_provider: PrepareProvider | None = None,
) -> None:
    """Run a generation task, updating job status in DB."""
    global _current_job_id
    db: Session = SessionLocal()
    monitor: asyncio.Task | None = None
    start_time = time.monotonic()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        if job.status == "failed":
            # Job was cancelled before it started
            return
        feature = job.feature
        user_id = job.user_id
        job.status = "processing"
        job.progress_percent = max(job.progress_percent or 0, 1)
        job.progress_label = job.progress_label or "Starting"
        db.commit()

        logger.info("job_started job_id=%s feature=%s user_id=%s", job_id, feature, user_id)

        if progress_provider:
            update_job_progress(job_id, progress_percent=1, progress_label="Waiting for AI engine")
            async with _a1111_job_lock:
                _current_job_id = job_id
                try:
                    if prepare_provider:
                        update_job_progress(job_id, progress_percent=2, progress_label="Freeing AI memory")
                        await _run_prepare(job_id, prepare_provider)
                    update_job_progress(job_id, progress_percent=3, progress_label="Starting AI engine")
                    monitor = asyncio.create_task(_monitor_progress(job_id, progress_provider))
                    await task_fn()
                finally:
                    _current_job_id = None
        else:
            await task_fn()

        duration_ms = int((time.monotonic() - start_time) * 1000)
        job = db.query(Job).filter(Job.id == job_id).first()
        job.status = "done"
        job.progress_percent = 100
        job.current_step = job.total_steps
        job.eta_seconds = 0
        job.progress_label = "Complete"
        job.completed_at = datetime.utcnow()
        db.commit()
        logger.info("job_done job_id=%s feature=%s user_id=%s duration_ms=%s", job_id, feature, user_id, duration_ms)
    except Exception as e:
        duration_ms = int((time.monotonic() - start_time) * 1000)
        logger.exception("job_failed job_id=%s error=%s duration_ms=%s", job_id, e, duration_ms)
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "failed"
            job.progress_label = "Failed"
            job.error_message = _user_visible_error(e)
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        _current_job_id = None
        if monitor:
            monitor.cancel()
            try:
                await monitor
            except asyncio.CancelledError:
                pass
        db.close()


def get_current_job_id() -> str | None:
    """Return the job_id currently holding the A1111 lock, or None."""
    return _current_job_id


async def _run_prepare(job_id: str, prepare_provider: PrepareProvider) -> None:
    try:
        await prepare_provider()
    except Exception as exc:
        logger.warning("job_prepare_failed job_id=%s error=%s", job_id, exc)


async def _monitor_progress(job_id: str, progress_provider: ProgressProvider) -> None:
    while True:
        try:
            raw = await progress_provider()
            update_job_progress(job_id, **_parse_a1111_progress(raw))
        except Exception as exc:
            logger.warning("job_progress_poll_failed job_id=%s error=%s", job_id, exc)
            pass
        await asyncio.sleep(1.0)


def _parse_a1111_progress(raw: dict[str, Any]) -> dict[str, Any]:
    state = raw.get("state") or {}
    progress = raw.get("progress")
    percent = None
    if isinstance(progress, (float, int)):
        percent = min(95, max(1, int(float(progress) * 100)))

    current_step = _int_or_none(state.get("sampling_step"))
    total_steps = _int_or_none(state.get("sampling_steps"))
    eta_seconds = _int_or_none(raw.get("eta_relative"))
    label = "Processing"
    if current_step is not None and total_steps:
        label = f"Step {current_step} of {total_steps}"

    return {
        "progress_percent": percent,
        "current_step": current_step,
        "total_steps": total_steps,
        "eta_seconds": eta_seconds,
        "progress_label": label,
    }


def update_job_progress(
    job_id: str,
    progress_percent: int | None = None,
    current_step: int | None = None,
    total_steps: int | None = None,
    eta_seconds: int | None = None,
    estimated_seconds: int | None = None,
    progress_label: str | None = None,
) -> None:
    db: Session = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job or job.status not in {"pending", "processing"}:
            return
        if progress_percent is not None:
            job.progress_percent = min(100, max(0, progress_percent))
        if current_step is not None:
            job.current_step = current_step
        if total_steps is not None:
            job.total_steps = total_steps
        if eta_seconds is not None:
            job.eta_seconds = max(0, eta_seconds)
        if estimated_seconds is not None:
            job.estimated_seconds = max(0, estimated_seconds)
        if progress_label:
            job.progress_label = progress_label
        db.commit()
    finally:
        db.close()


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _user_visible_error(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return message
    return f"{type(exc).__name__}: AI job failed without a detailed error message"
