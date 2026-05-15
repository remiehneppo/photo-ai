import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image as PILImage

from app.config import MAX_UPLOAD_BYTES
from app.services import storage_service
from app.services.upload_service import validate_image_bytes


def test_storage_service_saves_input_and_output(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service, "STORAGE_PATH", str(tmp_path))

    input_path, input_name = asyncio.run(storage_service.save_upload(b"input-bytes", ".jpg"))
    output_path, output_name = asyncio.run(storage_service.save_output(b"output-bytes"))

    assert (tmp_path / "input" / input_name).read_bytes() == b"input-bytes"
    assert (tmp_path / "output" / output_name).read_bytes() == b"output-bytes"
    assert input_path.endswith(input_name)
    assert output_path.endswith(output_name)
    assert storage_service.get_image_url(output_name) == f"/api/images/output/{output_name}"


def test_delete_image_file_only_removes_files_inside_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service, "STORAGE_PATH", str(tmp_path))
    stored = tmp_path / "output" / "image.png"
    stored.parent.mkdir(parents=True)
    stored.write_bytes(b"image")
    outside = tmp_path.parent / "outside.png"
    outside.write_bytes(b"outside")

    storage_service.delete_image_file(str(stored))
    storage_service.delete_image_file(str(outside))

    assert not stored.exists()
    assert outside.exists()


def test_validate_image_bytes_accepts_real_png():
    image = PILImage.new("RGB", (8, 6), (10, 20, 30))
    buf = BytesIO()
    image.save(buf, format="PNG")

    assert validate_image_bytes(buf.getvalue()) == (8, 6)


def test_validate_image_bytes_rejects_invalid_data():
    with pytest.raises(HTTPException) as exc:
        validate_image_bytes(b"not-an-image")

    assert exc.value.status_code == 400


def test_validate_image_bytes_rejects_oversized_payload():
    with pytest.raises(HTTPException) as exc:
        validate_image_bytes(b"x" * (MAX_UPLOAD_BYTES + 1))

    assert exc.value.status_code == 413
