import asyncio
import logging
from datetime import datetime
from typing import Awaitable, Callable, Any
from sqlalchemy.orm import Session
from app.models.job import Job
from app.database import SessionLocal

logger = logging.getLogger("photo_ai.jobs")

ProgressProvider = Callable[[], Awaitable[dict[str, Any]]]


async def run_job(
    job_id: str,
    task_fn: Callable[[], Any],
    progress_provider: ProgressProvider | None = None,
) -> None:
    """Run a generation task, updating job status in DB."""
    db: Session = SessionLocal()
    monitor: asyncio.Task | None = None
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        job.status = "processing"
        job.progress_percent = max(job.progress_percent or 0, 1)
        job.progress_label = job.progress_label or "Starting"
        db.commit()

        if progress_provider:
            monitor = asyncio.create_task(_monitor_progress(job_id, progress_provider))

        await task_fn()

        job = db.query(Job).filter(Job.id == job_id).first()
        job.status = "done"
        job.progress_percent = 100
        job.current_step = job.total_steps
        job.eta_seconds = 0
        job.progress_label = "Complete"
        job.completed_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        logger.exception("job_failed job_id=%s error=%s", job_id, e)
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "failed"
            job.progress_label = "Failed"
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        if monitor:
            monitor.cancel()
            try:
                await monitor
            except asyncio.CancelledError:
                pass
        db.close()


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
