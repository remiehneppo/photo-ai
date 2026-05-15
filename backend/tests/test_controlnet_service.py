import asyncio

import pytest

from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts


class FakeA1111:
    async def get_controlnet_models(self):
        return ["control_v11p_sd15_canny", "control_v11p_sd15_depth"]


def test_build_controlnet_scripts_selects_model_by_mode():
    scripts = asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "edges", 0.8))
    unit = scripts["ControlNet"]["args"][0]

    assert unit["image"] == "encoded-reference"
    assert unit["module"] == "canny"
    assert unit["model"] == "control_v11p_sd15_canny"
    assert unit["weight"] == 0.8


def test_build_controlnet_scripts_reports_missing_mode_model():
    with pytest.raises(RuntimeError, match="Missing ControlNet model for mode: pose"):
        asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "pose", 0.8))


def test_merge_alwayson_scripts_combines_extensions():
    merged = merge_alwayson_scripts({"ControlNet": {"args": [1]}}, {"ADetailer": {"args": [2]}})

    assert set(merged) == {"ControlNet", "ADetailer"}
