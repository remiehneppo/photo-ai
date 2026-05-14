import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.job import Job
from app.models.user import User
from app.services import job_service


def make_session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_job(session_factory, job_id="job-1"):
    db = session_factory()
    db.add(User(id="user-1", email="a@example.com", username="alice", hashed_password="hash"))
    db.add(Job(id=job_id, user_id="user-1", feature="txt2img", status="pending"))
    db.commit()
    db.close()


def get_job(session_factory, job_id="job-1"):
    db = session_factory()
    job = db.query(Job).filter(Job.id == job_id).first()
    db.expunge(job)
    db.close()
    return job


def test_run_job_marks_success(monkeypatch):
    session_factory = make_session_factory()
    seed_job(session_factory)
    monkeypatch.setattr(job_service, "SessionLocal", session_factory)

    async def task():
        return None

    asyncio.run(job_service.run_job("job-1", task))

    job = get_job(session_factory)
    assert job.status == "done"
    assert job.progress_percent == 100
    assert job.progress_label == "Complete"
    assert job.completed_at is not None
    assert job.error_message is None


def test_run_job_marks_failure(monkeypatch):
    session_factory = make_session_factory()
    seed_job(session_factory)
    monkeypatch.setattr(job_service, "SessionLocal", session_factory)

    async def task():
        raise RuntimeError("A1111 offline")

    asyncio.run(job_service.run_job("job-1", task))

    job = get_job(session_factory)
    assert job.status == "failed"
    assert job.error_message == "A1111 offline"
    assert job.progress_label == "Failed"
    assert job.completed_at is not None


def test_update_job_progress_sets_user_visible_fields(monkeypatch):
    session_factory = make_session_factory()
    seed_job(session_factory)
    monkeypatch.setattr(job_service, "SessionLocal", session_factory)

    job_service.update_job_progress(
        "job-1",
        progress_percent=42,
        current_step=4,
        total_steps=10,
        eta_seconds=12,
        estimated_seconds=30,
        progress_label="Step 4 of 10",
    )

    job = get_job(session_factory)
    assert job.progress_percent == 42
    assert job.current_step == 4
    assert job.total_steps == 10
    assert job.eta_seconds == 12
    assert job.estimated_seconds == 30
    assert job.progress_label == "Step 4 of 10"
