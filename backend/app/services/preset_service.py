import yaml
import os
from typing import Any


_config: dict | None = None


def _load_config() -> dict:
    global _config
    if _config is None:
        config_path = os.path.join(os.path.dirname(__file__), "../presets/config.yaml")
        with open(config_path, "r") as f:
            _config = yaml.safe_load(f)
    return _config


def get_preset(feature: str, style: str) -> dict[str, Any]:
    config = _load_config()
    presets = config.get("presets", {})
    feature_presets = presets.get(feature, {})
    preset = feature_presets.get(style)
    if preset is None:
        raise ValueError(f"No preset for feature='{feature}' style='{style}'")
    return dict(preset)


def get_upscale_preset(mode: str = "default") -> dict[str, Any]:
    config = _load_config()
    upscale = config.get("presets", {}).get("upscale", {})
    preset = upscale.get(mode)
    if preset is None:
        raise ValueError(f"No upscale preset for mode='{mode}'")
    return dict(preset)


def get_model_meta(model_name: str) -> dict[str, Any]:
    config = _load_config()
    return config.get("models", {}).get(model_name, {"sd_version": "1.5"})


def merge_prompt(base_positive: str, user_prompt: str) -> str:
    if user_prompt and user_prompt.strip():
        return f"{user_prompt.strip()}, {base_positive}"
    return base_positive


def available_styles(feature: str) -> list[str]:
    config = _load_config()
    return list(config.get("presets", {}).get(feature, {}).keys())


def available_upscale_modes() -> list[str]:
    config = _load_config()
    return list(config.get("presets", {}).get("upscale", {}).keys())
