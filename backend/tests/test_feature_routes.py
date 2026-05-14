import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as database
from app.services import job_service
from app.database import Base
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.routers import edit, generate, jobs, outpaint, sharpen, upscale


class FakeA1111:
    def __init__(self):
        self.payloads = []

    async def txt2img(self, payload):
        self.payloads.append(("txt2img", payload))
        return ["encoded-output"]

    async def img2img(self, payload):
        self.payloads.append(("img2img", payload))
        return ["encoded-output"]

    async def upscale(self, payload):
        self.payloads.append(("upscale", payload))
        return "encoded-output"

    async def get_progress(self):
        return {"progress": 0.5, "eta_relative": 10, "state": {"sampling_step": 5, "sampling_steps": 10}}

    @staticmethod
    def decode_image(_value):
        return b"output-bytes"

    @staticmethod
    def encode_image(_value):
        return "encoded-input"


class Upload:
    async def read(self):
        return b"input-bytes"


class PngUpload:
    async def read(self):
        return (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?"
            b"\x00\x05\xfe\x02\xfeA\xde\x83\xb1\x00\x00\x00\x00IEND\xaeB`\x82"
        )


class CapturedTasks:
    def __init__(self):
        self.tasks = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args, kwargs))


async def call_and_run_tasks(coro, tasks):
    response = await coro
    for func, args, kwargs in tasks.tasks:
        result = func(*args, **kwargs)
        if hasattr(result, "__await__"):
            await result
    return response


def session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_user(db):
    user = User(id="user-1", email="a@example.com", username="alice", hashed_password="hash")
    db.add(user)
    db.commit()
    return user


def patch_common(monkeypatch, router_module, session_factory_, fake):
    monkeypatch.setattr(router_module, "a1111", fake, raising=False)
    monkeypatch.setattr(router_module, "SessionLocal", session_factory_, raising=False)
    monkeypatch.setattr(database, "SessionLocal", session_factory_)
    monkeypatch.setattr(job_service, "SessionLocal", session_factory_)
    monkeypatch.setattr(router_module, "save_output", lambda _bytes: async_return(("/tmp/output.png", "output.png")), raising=False)
    monkeypatch.setattr(router_module, "save_upload", lambda _bytes: async_return(("/tmp/input.png", "input.png")), raising=False)
    monkeypatch.setattr(router_module, "run_job", run_immediately, raising=False)


async def async_return(value):
    return value


async def run_immediately(_job_id, task_fn, *_args):
    await task_fn()


def test_generate_route_creates_job_and_output_image(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="cinematic portrait", style="realistic"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert db.query(Job).filter(Job.id == response.job_id).first().feature == "txt2img"
    assert db.query(Image).filter(Image.job_id == response.job_id).first().filename == "output.png"
    assert fake.payloads[0][0] == "txt2img"
    assert "cinematic portrait" in fake.payloads[0][1]["prompt"]


def test_edit_route_saves_input_and_output(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, edit, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        edit.edit_image(
            background_tasks=tasks,
            prompt="make it dramatic",
            style="realistic",
            image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    images = db.query(Image).filter(Image.job_id == response.job_id).all()
    assert {image.type for image in images} == {"input", "output"}
    assert fake.payloads[0][0] == "img2img"
    assert fake.payloads[0][1]["init_images"] == ["encoded-input"]


def test_upscale_route_uses_upscale_endpoint(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, upscale, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        upscale.upscale_image(
            background_tasks=tasks,
            image=Upload(),
            mode="face_restore",
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert db.query(Job).filter(Job.id == response.job_id).first().feature == "upscale"
    assert fake.payloads[0][0] == "upscale"
    assert fake.payloads[0][1]["gfpgan_visibility"] == 0.5


def test_sharpen_route_saves_input_and_output(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, sharpen, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        sharpen.sharpen_image(
            background_tasks=tasks,
            image=PngUpload(),
            mode="strong",
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    db_job = db.query(Job).filter(Job.id == response.job_id).first()
    images = db.query(Image).filter(Image.job_id == response.job_id).all()
    assert db_job.feature == "sharpen"
    assert db_job.style == "strong"
    assert {image.type for image in images} == {"input", "output"}


def test_outpaint_route_builds_mask_payload(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, outpaint, factory, fake)
    monkeypatch.setattr(outpaint, "expand_canvas", lambda _bytes, _direction, _px: (b"expanded", b"mask"))
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        outpaint.outpaint_image(
            background_tasks=tasks,
            image=Upload(),
            direction="left",
            style="realistic",
            prompt="continue background",
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert db.query(Job).filter(Job.id == response.job_id).first().feature == "outpaint"
    assert fake.payloads[0][0] == "img2img"
    assert fake.payloads[0][1]["mask"] == "encoded-input"


def test_jobs_route_returns_current_user_history():
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    other = User(id="user-2", email="b@example.com", username="bob", hashed_password="hash")
    db.add(other)
    db.add(Job(id="job-1", user_id=user.id, feature="txt2img", style="realistic", status="done", progress_percent=100, progress_label="Complete"))
    db.add(Job(id="job-2", user_id=other.id, feature="txt2img", style="realistic", status="done"))
    db.add(Image(id="image-1", job_id="job-1", user_id=user.id, type="output", file_path="/tmp/output.png", filename="output.png"))
    db.commit()

    result = jobs.list_jobs(db=db, current_user=user)
    detail = jobs.get_job(job_id="job-1", db=db, current_user=user)

    assert [job.id for job in result] == ["job-1"]
    assert detail.images[0].url == "/api/images/output/output.png"
    assert detail.progress_percent == 100
    assert detail.progress_label == "Complete"
