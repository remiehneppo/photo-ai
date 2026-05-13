import asyncio

from app.services import storage_service


def test_storage_service_saves_input_and_output(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service, "STORAGE_PATH", str(tmp_path))

    input_path, input_name = asyncio.run(storage_service.save_upload(b"input-bytes", ".jpg"))
    output_path, output_name = asyncio.run(storage_service.save_output(b"output-bytes"))

    assert (tmp_path / "input" / input_name).read_bytes() == b"input-bytes"
    assert (tmp_path / "output" / output_name).read_bytes() == b"output-bytes"
    assert input_path.endswith(input_name)
    assert output_path.endswith(output_name)
    assert storage_service.get_image_url(output_name) == f"/api/images/output/{output_name}"
