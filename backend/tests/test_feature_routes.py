import asyncio
from io import BytesIO
from typing import Any, Optional

from PIL import Image as PILImage

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as database
import app.services.storage_service as storage_service
from app.services import job_service
from app.database import Base
from app.models.image import Image
from app.models.job import Job
from app.models.user import User
from app.routers import capabilities, edit, generate, inpaint, jobs, outpaint, sharpen, upscale


class FakeA1111:
    def __init__(self):
        self.payloads = []

    async def txt2img(self, payload):
        self.payloads.append(("txt2img", payload))
        return (["encoded-output"], None)

    async def img2img(self, payload):
        self.payloads.append(("img2img", payload))
        return (["encoded-output"], None)

    async def upscale(self, payload):
        self.payloads.append(("upscale", payload))
        return "encoded-output"

    async def get_progress(self):
        return {"progress": 0.5, "eta_relative": 10, "state": {"sampling_step": 5, "sampling_steps": 10}}

    async def get_models(self):
        return [
            {"model_name": "RealVisXL_V5.0_fp16"},
            {"model_name": "realismIllustriousBy_v55FP16"},
            {"model_name": "anything-v5"},
            {"model_name": "Juggernaut-XL_v9_RunDiffusionPhoto_v2"},
            {"model_name": "v1-5-pruned-emaonly"},
        ]

    async def get_upscalers(self):
        return [{"name": "R-ESRGAN 4x+"}, {"name": "4x-UltraSharp"}]

    async def get_extensions(self):
        return [
            {"name": "sd-webui-controlnet"},
            {"name": "adetailer"},
            {"name": "sd-webui-segment-anything"},
        ]

    async def get_samplers(self):
        return [{"name": "Euler a"}, {"name": "DPM++ 2M Karras"}]

    async def get_controlnet_models(self):
        return ["control_v11p_sd15_canny", "control_v11p_sd15_openpose", "xinsir_controlnet_union_sdxl_1.0"]

    async def get_sam_models(self):
        return ["sam_vit_b_01ec64.pth"]

    async def load_checkpoint(self, model_name: str) -> None:
        pass

    async def interrupt(self) -> None:
        pass

    async def interrogate(self, _image_base64: str) -> dict[str, Any]:
        return {"caption": "a photo", "detail": "detailed"}

    async def sam_predict(self, _image_base64: str, _points: list[tuple[float, float]], _labels: list[int]) -> str | None:
        return None

    async def upscale_batch(self, _payload: dict[str, Any]) -> list[str]:
        return ["upscaled"]

    async def offload_unused_models(self) -> None:
        pass

    async def cleanup_after_job(self) -> None:
        pass

    async def sam_heartbeat(self):
        return True

    @staticmethod
    def decode_image(_value):
        return b"output-bytes"

    @staticmethod
    def encode_image(_value):
        return "encoded-input"


class OOMOnceA1111(FakeA1111):
    def __init__(self):
        super().__init__()
        self.calls = 0

    async def txt2img(self, payload):
        self.calls += 1
        self.payloads.append(("txt2img", payload))
        if self.calls == 1:
            raise RuntimeError("CUDA out of memory. Tried to allocate 1024.00 MiB.")
        return (["encoded-output"], None)


class OOMOnceImg2ImgA1111(FakeA1111):
    def __init__(self):
        super().__init__()
        self.calls = 0

    async def img2img(self, payload):
        self.calls += 1
        self.payloads.append(("img2img", payload))
        if self.calls == 1:
            raise RuntimeError("CUDA out of memory. Tried to allocate 4096.00 MiB.")
        return (["encoded-output"], None)


class Upload:
    async def read(self):
        return png_bytes()


class PngUpload:
    async def read(self):
        return png_bytes()


def png_bytes(width=17, height=11):
    image = PILImage.new("RGB", (width, height), (10, 20, 30))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


class SizedPngUpload:
    def __init__(self, width=17, height=11):
        self.width = width
        self.height = height

    async def read(self):
        return png_bytes(self.width, self.height)


class MaskUpload:
    async def read(self):
        image = PILImage.new("L", (17, 11), 0)
        for x in range(4, 12):
            for y in range(3, 9):
                image.putpixel((x, y), 255)
        buf = BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()


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
    # save_output/save_upload may live in the router OR in storage_service (used by job_service)
    monkeypatch.setattr(storage_service, "save_output", lambda _bytes: async_return(("/tmp/output.png", "output.png")))
    monkeypatch.setattr(storage_service, "save_upload", lambda _bytes: async_return(("/tmp/input.png", "input.png")))
    monkeypatch.setattr(router_module, "save_output", lambda _bytes: async_return(("/tmp/output.png", "output.png")), raising=False)
    monkeypatch.setattr(router_module, "save_upload", lambda _bytes: async_return(("/tmp/input.png", "input.png")), raising=False)
    monkeypatch.setattr(router_module, "run_job", run_immediately, raising=False)


async def async_return(value):
    return value


async def run_immediately(_job_id, task_fn, *_args, **_kwargs):
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
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "RealVisXL_V5.0_fp16"


def test_generate_route_uses_style_checkpoint_from_config(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="anime portrait", style="anime"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "anything-v5"


def test_generate_route_can_enable_adetailer(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="cinematic portrait", style="realistic", fix_face=True, fix_hands=True),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    adetailer_args = fake.payloads[0][1]["alwayson_scripts"]["ADetailer"]["args"]
    assert adetailer_args[2]["ad_model"] == "face_yolov8s.pt"
    assert adetailer_args[3]["ad_model"] == "hand_yolov8s.pt"


def test_generate_with_reference_adds_controlnet_payload(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="cinematic portrait",
            style="realistic",
            control_mode="edges",
            control_weight=0.8,
            fix_face=False,
            fix_hands=False,
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    controlnet_unit = fake.payloads[0][1]["alwayson_scripts"]["ControlNet"]["args"][0]
    assert controlnet_unit["image"] == "encoded-input"
    assert controlnet_unit["module"] == "canny"
    assert controlnet_unit["model"] == "control_v11p_sd15_canny"
    assert controlnet_unit["weight"] == 0.85
    assert controlnet_unit["control_mode"] == "ControlNet is more important"
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "v1-5-pruned-emaonly"


def test_generate_with_reference_pose_uses_openpose_checkpoint_pair(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="dancer in red dress",
            style="realistic",
            control_mode="pose",
            control_weight=0.7,
            fix_face=False,
            fix_hands=False,
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    controlnet_unit = fake.payloads[0][1]["alwayson_scripts"]["ControlNet"]["args"][0]
    assert controlnet_unit["module"] == "openpose_full"
    assert controlnet_unit["model"] == "control_v11p_sd15_openpose"
    assert controlnet_unit["weight"] == 1.0
    assert controlnet_unit["control_mode"] == "ControlNet is more important"
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "v1-5-pruned-emaonly"


def test_generate_with_reference_product_layout_adds_reference_and_structure_units(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="product hero shot on marble desk",
            style="realistic",
            control_mode="product_layout",
            control_weight=0.6,
            fix_face=False,
            fix_hands=False,
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert fake.payloads[0][0] == "img2img"
    payload = fake.payloads[0][1]
    assert payload["init_images"] == ["encoded-input"]
    assert payload["denoising_strength"] == 0.52
    assert payload["width"] == 17
    assert payload["height"] == 11
    assert "preserve the exact same product identity" in payload["prompt"]
    assert "different product" in payload["negative_prompt"]
    reference_unit, structure_unit = payload["alwayson_scripts"]["ControlNet"]["args"]
    assert reference_unit["module"] == "reference_only"
    assert reference_unit["model"] == "None"
    assert reference_unit["control_mode"] == "Balanced"
    assert reference_unit["weight"] == 0.8
    assert reference_unit["guidance_end"] == 0.75
    assert structure_unit["module"] == "canny"
    assert structure_unit["model"] == "xinsir_controlnet_union_sdxl_1.0"
    assert structure_unit["guidance_end"] == 0.45
    assert structure_unit["control_mode"] == "Balanced"


def test_generate_with_reference_anime_style_keeps_style_checkpoint(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="anime girl with raincoat",
            style="anime",
            control_mode="edges",
            control_weight=0.7,
            fix_face=False,
            fix_hands=False,
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    payload = fake.payloads[0][1]
    assert payload["override_settings"]["sd_model_checkpoint"] == "anything-v5"
    assert payload["alwayson_scripts"]["ControlNet"]["args"][0]["module"] == "canny"


def test_generate_route_retries_with_smaller_payload_after_oom(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = OOMOnceA1111()
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
    assert len(fake.payloads) == 2
    first = fake.payloads[0][1]
    retry = fake.payloads[1][1]
    assert retry["width"] < first["width"]
    assert retry["height"] < first["height"]
    assert retry["steps"] < first["steps"]


def test_generate_with_reference_retries_with_smaller_payload_after_oom(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = OOMOnceA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="edge guided hero shot",
            style="realistic",
            control_mode="edges",
            control_weight=0.6,
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert len(fake.payloads) == 2
    first = fake.payloads[0][1]
    retry = fake.payloads[1][1]
    assert retry["width"] < first["width"]
    assert retry["height"] < first["height"]
    assert retry["steps"] < first["steps"]


def test_product_reference_dimensions_caps_large_images():
    assert generate._product_reference_dimensions(1500, 1500) == (768, 768)
    assert generate._product_reference_dimensions(1500, 1000) == (768, 512)
    assert generate._product_reference_dimensions(512, 512) == (512, 512)


def test_generate_with_product_reference_retries_img2img_with_smaller_payload_after_oom(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = OOMOnceImg2ImgA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate_with_reference(
            background_tasks=tasks,
            prompt="product hero shot",
            style="realistic",
            control_mode="product_layout",
            control_weight=1.0,
            control_image=SizedPngUpload(width=1500, height=1500),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert len(fake.payloads) == 2
    first = fake.payloads[0][1]
    retry = fake.payloads[1][1]
    assert first["width"] == 768
    assert first["height"] == 768
    assert retry["width"] < first["width"]
    assert retry["height"] < first["height"]
    assert retry["steps"] < first["steps"]


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
            image=SizedPngUpload(17, 11),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    images = db.query(Image).filter(Image.job_id == response.job_id).all()
    assert {image.type for image in images} == {"input", "output"}
    assert fake.payloads[0][0] == "img2img"
    assert fake.payloads[0][1]["init_images"] == ["encoded-input"]
    assert fake.payloads[0][1]["width"] == 17
    assert fake.payloads[0][1]["height"] == 11
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "RealVisXL_V5.0_fp16"


def test_edit_resizes_output_to_match_source_size():
    resized_bytes = edit.ensure_image_size(png_bytes(4, 3), (17, 11))

    with PILImage.open(BytesIO(resized_bytes)) as image:
        assert image.size == (17, 11)


def test_edit_route_can_add_controlnet_payload(monkeypatch):
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
            fix_face=False,
            fix_hands=False,
            control_mode="edges",
            control_weight=0.9,
            image=SizedPngUpload(13, 9),
            control_image=Upload(),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    controlnet_unit = fake.payloads[0][1]["alwayson_scripts"]["ControlNet"]["args"][0]
    assert controlnet_unit["module"] == "canny"
    assert controlnet_unit["weight"] == 0.9


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
    monkeypatch.setattr(outpaint, "expand_canvas", lambda _bytes, _direction, _px: (png_bytes(17, 11), png_bytes(17, 11)))
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
    assert fake.payloads[0][1]["width"] > 0
    assert fake.payloads[0][1]["height"] > 0
    assert fake.payloads[0][1]["override_settings"]["sd_model_checkpoint"] == "v1-5-pruned-emaonly"


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

    result = jobs.list_jobs(db=db, current_user=user, skip=0, limit=20)
    detail = jobs.get_job(job_id="job-1", db=db, current_user=user)

    assert [job.id for job in result.items] == ["job-1"]
    assert detail.images[0].url == "/api/images/output/output.png"
    assert detail.progress_percent == 100
    assert detail.progress_label == "Complete"


def test_jobs_route_clamps_to_requested_limit():
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    for index in range(3):
        db.add(Job(id=f"job-{index}", user_id=user.id, feature="txt2img", style="realistic", status="done", progress_percent=100))
    db.commit()

    result = jobs.list_jobs(db=db, current_user=user, skip=0, limit=2)

    assert len(result.items) == 2


def test_delete_job_removes_only_current_user_history(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    other = User(id="user-2", email="b@example.com", username="bob", hashed_password="hash")
    db.add(other)
    db.add(Job(id="job-1", user_id=user.id, feature="txt2img", style="realistic", status="done"))
    db.add(Job(id="job-2", user_id=other.id, feature="txt2img", style="realistic", status="done"))
    db.add(Image(id="image-1", job_id="job-1", user_id=user.id, type="output", file_path="/tmp/output.png", filename="output.png"))
    db.commit()
    deleted_paths = []
    monkeypatch.setattr(jobs, "delete_image_file", deleted_paths.append)

    response = jobs.delete_job(job_id="job-1", db=db, current_user=user)

    assert response.status_code == 204
    assert deleted_paths == ["/tmp/output.png"]
    assert db.query(Job).filter(Job.id == "job-1").first() is None
    assert db.query(Image).filter(Image.id == "image-1").first() is None
    assert db.query(Job).filter(Job.id == "job-2").first() is not None


def test_delete_job_rejects_active_job():
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    db.add(Job(id="job-1", user_id=user.id, feature="txt2img", style="realistic", status="processing"))
    db.commit()

    try:
        jobs.delete_job(job_id="job-1", db=db, current_user=user)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409
    else:
        raise AssertionError("active job deletion was accepted")
    assert db.query(Job).filter(Job.id == "job-1").first() is not None


def test_upscale_rejects_unknown_mode_before_upload_read(monkeypatch):
    class UnreadableUpload:
        async def read(self):
            raise AssertionError("upload should not be read for an invalid mode")

    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, upscale, factory, fake)
    tasks = CapturedTasks()

    try:
        asyncio.run(
            upscale.upscale_image(
                background_tasks=tasks,
                image=UnreadableUpload(),
                mode="missing",
                db=db,
                current_user=user,
            )
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
    else:
        raise AssertionError("invalid upscale mode was accepted")


def test_capabilities_route_reports_a1111_features(monkeypatch):
    fake = FakeA1111()
    monkeypatch.setattr(capabilities, "a1111", fake)
    # Clear cache so test doesn't hit stale data
    capabilities._capabilities_cache.clear()

    result = asyncio.run(capabilities.get_capabilities())

    assert result.a1111_connected is True
    assert result.checkpoints == ["RealVisXL_V5.0_fp16", "realismIllustriousBy_v55FP16", "anything-v5", "Juggernaut-XL_v9_RunDiffusionPhoto_v2", "v1-5-pruned-emaonly"]
    assert result.upscalers == ["R-ESRGAN 4x+", "4x-UltraSharp"]
    assert result.samplers == ["Euler a", "DPM++ 2M Karras"]
    assert result.controlnet_available is True
    assert result.controlnet_models == ["control_v11p_sd15_canny", "control_v11p_sd15_openpose", "xinsir_controlnet_union_sdxl_1.0"]
    assert result.adetailer_available is True
    assert result.sam_available is True
    assert result.sam_models == ["sam_vit_b_01ec64.pth"]


# ── Phase G tests ──────────────────────────────────────────────────────────────

def test_generate_aspect_ratio_overrides_preset_dimensions(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="test", style="realistic", aspect_ratio="16:9"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    payload = fake.payloads[0][1]
    assert payload["width"] == 912
    assert payload["height"] == 512


def test_generate_negative_prompt_prepended(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="portrait", style="realistic", negative_prompt="blurry, low quality"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    negative = fake.payloads[0][1]["negative_prompt"]
    assert negative.startswith("blurry, low quality,")


def test_generate_advanced_params_override_preset(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="portrait", style="realistic", steps=30, cfg_scale=9.0, sampler_name="DPM++ 2M Karras"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    payload = fake.payloads[0][1]
    assert payload["steps"] == 30
    assert payload["cfg_scale"] == 9.0
    assert payload["sampler_name"] == "DPM++ 2M Karras"


def test_generate_batch_count_creates_multiple_images(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="portrait", style="realistic", batch_count=3),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    # 3 txt2img calls
    assert len([p for p in fake.payloads if p[0] == "txt2img"]) == 3
    # 3 output images saved
    images = db.query(Image).filter(Image.job_id == response.job_id, Image.type == "output").all()
    assert len(images) == 3


def test_generate_tiling_param_forwarded(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="texture", style="realistic", tiling=True),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert fake.payloads[0][1]["tiling"] is True


def test_generate_checkpoint_override_skips_resolve(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, generate, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        generate.generate(
            req=generate.GenerateRequest(prompt="portrait", style="realistic", checkpoint="my-custom-model"),
            background_tasks=tasks,
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    payload = fake.payloads[0][1]
    assert payload["override_settings"]["sd_model_checkpoint"] == "my-custom-model"


def test_enhance_prompt_returns_enriched_text():
    req = generate.EnhancePromptRequest(prompt="a dog", style="realistic")
    result = generate.enhance_prompt(req)
    assert "a dog" in result["prompt"]
    # Should have quality tags from preset appended
    assert len(result["prompt"]) > len("a dog")


def test_upscale_route_accepts_custom_upscaler(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    fake = FakeA1111()
    patch_common(monkeypatch, upscale, factory, fake)
    tasks = CapturedTasks()

    asyncio.run(call_and_run_tasks(
        upscale.upscale_image(
            background_tasks=tasks,
            image=PngUpload(),
            mode="default",
            upscaler="4x-UltraSharp",
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert fake.payloads[0][1]["upscaler_1"] == "4x-UltraSharp"


def test_jobs_route_filter_by_feature(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)
    db.add(Job(id="job-gen", user_id=user.id, feature="txt2img", style="realistic", status="done", progress_percent=100))
    db.add(Job(id="job-edit", user_id=user.id, feature="img2img", style="realistic", status="done", progress_percent=100))
    db.commit()

    result = jobs.list_jobs(db=db, current_user=user, skip=0, limit=20, feature="txt2img")

    assert len(result.items) == 1
    assert result.items[0].id == "job-gen"


def test_capabilities_cache_returns_same_result(monkeypatch):
    fake = FakeA1111()
    monkeypatch.setattr(capabilities, "a1111", fake)
    capabilities._capabilities_cache.clear()

    result1 = asyncio.run(capabilities.get_capabilities())
    result2 = asyncio.run(capabilities.get_capabilities())

    assert result1.a1111_connected == result2.a1111_connected
    # Second call should hit cache, not call get_models again
    # (get_models was only called once since cache TTL hasn't expired)
    assert result1.checkpoints == result2.checkpoints


def test_inpaint_route_composites_reference_image_into_mask(monkeypatch):
    factory = session_factory()
    db = factory()
    user = seed_user(db)

    class EncodingFake(FakeA1111):
        def encode_image(self, value):
            return "encoded-composite" if value == b"composited" else "encoded-input"

    fake = EncodingFake()
    patch_common(monkeypatch, inpaint, factory, fake)
    monkeypatch.setattr(inpaint, "composite_reference_into_mask", lambda *_args: b"composited")
    tasks = CapturedTasks()

    response = asyncio.run(call_and_run_tasks(
        inpaint.inpaint_image(
            background_tasks=tasks,
            prompt="place the object on the table",
            style="realistic",
            image=SizedPngUpload(17, 11),
            mask=MaskUpload(),
            reference_image=SizedPngUpload(6, 6),
            db=db,
            current_user=user,
        ),
        tasks,
    ))

    assert response.status == "pending"
    assert fake.payloads[0][0] == "img2img"
    payload = fake.payloads[0][1]
    assert payload["init_images"] == ["encoded-composite"]
    assert "integrate the referenced subject" in payload["prompt"]
    assert payload["denoising_strength"] >= 0.58
