from app.services.model_service import add_model_override, select_checkpoint


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
