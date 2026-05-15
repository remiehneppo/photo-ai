from app.services import preset_service
import pytest


def test_get_preset_returns_copy_and_style_settings():
    preset = preset_service.get_preset("txt2img", "realistic")
    preset["steps"] = 1

    fresh = preset_service.get_preset("txt2img", "realistic")

    assert fresh["model"] == "realismIllustriousBy_v55FP16"
    assert fresh["steps"] == 30
    assert "base_positive" in fresh


def test_prompt_merge_and_style_listing():
    assert preset_service.merge_prompt("base quality", "user prompt") == "user prompt, base quality"
    assert preset_service.merge_prompt("base quality", "   ") == "base quality"
    assert "anime" in preset_service.available_styles("txt2img")


def test_upscale_preset_and_model_metadata():
    face_restore = preset_service.get_upscale_preset("face_restore")
    missing_model = preset_service.get_model_meta("missing")

    assert face_restore["upscaler_1"] == "R-ESRGAN 4x+"
    assert face_restore["gfpgan_visibility"] == 0.5
    assert missing_model == {"sd_version": "1.5"}


def test_unknown_upscale_mode_is_rejected():
    with pytest.raises(ValueError):
        preset_service.get_upscale_preset("missing")


def test_available_upscale_modes_come_from_config():
    assert "face_restore" in preset_service.available_upscale_modes()
