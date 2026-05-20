import asyncio

import pytest

from app.services.controlnet_service import build_controlnet_scripts, merge_alwayson_scripts


class FakeA1111:
    async def get_controlnet_models(self):
        return ["control_v11p_sd15_canny", "control_v11p_sd15_depth"]


class FakeMixedA1111:
    async def get_controlnet_models(self):
        return [
            "control_v11p_sd15_canny",
            "control_v11p_sd15_depth",
            "control_v11p_sd15_openpose",
            "xinsir_controlnet_union_sdxl_1.0",
        ]


def test_build_controlnet_scripts_selects_model_by_mode():
    scripts = asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "edges", 0.8))
    unit = scripts["ControlNet"]["args"][0]

    assert unit["image"] == "encoded-reference"
    assert unit["module"] == "canny"
    assert unit["model"] == "control_v11p_sd15_canny"
    assert unit["weight"] == 0.85
    assert unit["control_mode"] == "ControlNet is more important"


def test_build_controlnet_scripts_falls_back_for_sketch_modes():
    scripts = asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "lineart", 0.8))
    unit = scripts["ControlNet"]["args"][0]

    assert unit["module"] == "canny"
    assert unit["model"] == "control_v11p_sd15_canny"
    assert unit["threshold_a"] == 100


def test_build_controlnet_scripts_prefers_union_for_sdxl():
    scripts = asyncio.run(build_controlnet_scripts(FakeMixedA1111(), "encoded-reference", "edges", 0.8, prefer_sdxl=True))
    unit = scripts["ControlNet"]["args"][0]

    assert unit["module"] == "canny"
    assert unit["model"] == "xinsir_controlnet_union_sdxl_1.0"


def test_build_controlnet_scripts_pose_uses_openpose_with_strong_guidance():
    scripts = asyncio.run(build_controlnet_scripts(FakeMixedA1111(), "encoded-reference", "pose", 0.7))
    unit = scripts["ControlNet"]["args"][0]

    assert unit["module"] == "openpose_full"
    assert unit["model"] == "control_v11p_sd15_openpose"
    assert unit["weight"] == 1.0
    assert unit["control_mode"] == "ControlNet is more important"


def test_build_controlnet_scripts_product_layout_uses_reference_and_structure_units():
    scripts = asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "product_layout", 0.85))
    reference_unit, structure_unit = scripts["ControlNet"]["args"]

    assert reference_unit["module"] == "reference_only"
    assert reference_unit["model"] == "None"
    assert reference_unit["weight"] == 0.85
    assert reference_unit["guidance_end"] == 0.75
    assert reference_unit["control_mode"] == "Balanced"
    assert structure_unit["module"] == "canny"
    assert structure_unit["model"] == "control_v11p_sd15_canny"
    assert structure_unit["weight"] == 0.3825
    assert structure_unit["guidance_end"] == 0.45
    assert structure_unit["control_mode"] == "Balanced"


def test_build_controlnet_scripts_reports_missing_mode_model():
    with pytest.raises(RuntimeError, match="Missing ControlNet model for mode: pose"):
        asyncio.run(build_controlnet_scripts(FakeA1111(), "encoded-reference", "pose", 0.8))


def test_merge_alwayson_scripts_combines_extensions():
    merged = merge_alwayson_scripts({"ControlNet": {"args": [1]}}, {"ADetailer": {"args": [2]}})

    assert set(merged) == {"ControlNet", "ADetailer"}
