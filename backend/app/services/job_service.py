import asyncio
from datetime import datetime
from typing import Callable, Any
from sqlalchemy.orm import Session
from app.models.job import Job
from app.database import SessionLocal


async def run_job(
    job_id: str,
    task_fn: Callable[[], Any],
) -> None:
    """Run a generation task, updating job status in DB."""
    db: Session = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        job.status = "processing"
        db.commit()

        await task_fn()

        job = db.query(Job).filter(Job.id == job_id).first()
        job.status = "done"
        job.completed_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "failed"
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()
