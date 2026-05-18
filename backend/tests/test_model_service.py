import asyncio

from app.services.model_service import add_model_override, resolve_controlnet_checkpoint, select_checkpoint


class FakeControlNetA1111:
    async def get_models(self):
        return [
            {"model_name": "realismIllustriousBy_v55FP16"},
            {"model_name": "chilloutmix_NiPrunedFp32Fix"},
            {"model_name": "Juggernaut-XL_v9_RunDiffusionPhoto_v2"},
        ]

    async def get_controlnet_models(self):
        return ["control_v11p_sd15_canny [d14c016b]"]


def test_select_checkpoint_matches_config_model_names():
    candidates = [
        "anything-v5",
        "Juggernaut-XL_v9_RunDiffusionPhoto_v2",
        "realismIllustriousBy_v55FP16",
    ]

    assert select_checkpoint(candidates, "anything-v5") == "anything-v5"
    assert select_checkpoint(candidates, "juggernautXL_v9Rdphoto2Lightning") == "Juggernaut-XL_v9_RunDiffusionPhoto_v2"
    assert select_checkpoint(candidates, "missing") is None


def test_add_model_override_sets_per_request_checkpoint():
    payload = add_model_override({"prompt": "x"}, "anything-v5")

    assert payload["override_settings"] == {"sd_model_checkpoint": "anything-v5"}
    assert payload["override_settings_restore_afterwards"] is True


def test_resolve_controlnet_checkpoint_uses_sd15_fallback_for_sd15_controlnet():
    checkpoint = asyncio.run(resolve_controlnet_checkpoint(FakeControlNetA1111(), "realismIllustriousBy_v55FP16"))

    assert checkpoint == "chilloutmix_NiPrunedFp32Fix"
