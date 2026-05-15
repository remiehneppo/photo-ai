import asyncio

from app.services.adetailer_service import build_adetailer_scripts, has_adetailer


class FakeA1111:
    def __init__(self, extensions):
        self.extensions = extensions

    async def get_extensions(self):
        return self.extensions


def test_build_adetailer_scripts_adds_face_and_hand_models():
    scripts = build_adetailer_scripts(fix_face=True, fix_hands=True)
    args = scripts["ADetailer"]["args"]

    assert args[0] is True
    assert args[1] is False
    assert args[2]["ad_model"] == "face_yolov8s.pt"
    assert args[3]["ad_model"] == "hand_yolov8s.pt"


def test_build_adetailer_scripts_returns_empty_when_disabled():
    assert build_adetailer_scripts() == {}


def test_has_adetailer_detects_extension_name():
    fake = FakeA1111([{"name": "adetailer"}])

    assert asyncio.run(has_adetailer(fake)) is True
    assert asyncio.run(has_adetailer(FakeA1111([{"name": "sd-webui-controlnet"}]))) is False
