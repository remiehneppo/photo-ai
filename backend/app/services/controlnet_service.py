from typing import Any


CONTROLNET_MODES = {
    "edges": {
        "label": "Edges",
        "module": "canny",
        "model_keyword": "canny",
        "processor_res": 512,
        "threshold_a": 100,
        "threshold_b": 200,
    },
    "depth": {
        "label": "Depth",
        "module": "depth_midas",
        "model_keyword": "depth",
        "processor_res": 512,
    },
    "pose": {
        "label": "Pose",
        "module": "openpose_full",
        "model_keyword": "openpose",
        "processor_res": 512,
    },
    "product_layout": {
        "label": "Product layout",
        "module": "canny",
        "model_keyword": "canny",
        "processor_res": 512,
        "threshold_a": 80,
        "threshold_b": 180,
    },
    "scribble": {
        "label": "Scribble / Sketch",
        "module": "scribble_hed",
        "model_keyword": "scribble",
        "processor_res": 512,
        "fallback_modes": ["edges"],
    },
    "lineart": {
        "label": "Lineart / Anime",
        "module": "lineart_anime",
        "model_keyword": "lineart",
        "processor_res": 512,
        "fallback_modes": ["scribble", "edges"],
    },
}


async def build_controlnet_scripts(
    a1111_client: Any,
    image_b64: str,
    mode: str,
    weight: float = 0.7,
    prefer_sdxl: bool = False,
) -> dict[str, Any]:
    validate_controlnet_mode(mode)

    models = await a1111_client.get_controlnet_models()
    mode_config = _select_mode_config(models, mode, prefer_sdxl=prefer_sdxl)
    model = _select_model(models, mode_config["model_keyword"], prefer_sdxl=prefer_sdxl)
    if not model:
        raise RuntimeError(f"Missing ControlNet model for mode: {mode}")

    unit = {
        "enabled": True,
        "image": image_b64,
        "module": mode_config["module"],
        "model": model,
        "weight": min(2.0, max(0.0, weight)),
        "resize_mode": "Crop and Resize",
        "processor_res": mode_config["processor_res"],
        "guidance_start": 0.0,
        "guidance_end": 1.0,
        "pixel_perfect": True,
        "control_mode": "Balanced",
    }
    if "threshold_a" in mode_config:
        unit["threshold_a"] = mode_config["threshold_a"]
    if "threshold_b" in mode_config:
        unit["threshold_b"] = mode_config["threshold_b"]

    return {
        "ControlNet": {
            "args": [unit],
        }
    }


def merge_alwayson_scripts(*scripts: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for script in scripts:
        merged.update(script)
    return merged


def validate_controlnet_mode(mode: str) -> None:
    if mode not in CONTROLNET_MODES:
        raise ValueError(f"Invalid ControlNet mode. Choose from: {list(CONTROLNET_MODES)}")


def _select_model(models: list[str], keyword: str, prefer_sdxl: bool = False) -> str | None:
    if prefer_sdxl:
        for model in models:
            if keyword.lower() in model.lower() and _is_sdxl_controlnet(model):
                return model
        for model in models:
            if _is_union_sdxl_controlnet(model):
                return model

    for model in models:
        if keyword.lower() in model.lower():
            return model
    return None


def _select_mode_config(models: list[str], mode: str, prefer_sdxl: bool = False) -> dict[str, Any]:
    config = CONTROLNET_MODES[mode]
    if _select_model(models, config["model_keyword"], prefer_sdxl=prefer_sdxl):
        return config

    for fallback_mode in config.get("fallback_modes", []):
        fallback_config = CONTROLNET_MODES[fallback_mode]
        if _select_model(models, fallback_config["model_keyword"], prefer_sdxl=prefer_sdxl):
            return fallback_config

    return config


def _is_sdxl_controlnet(model: str) -> bool:
    lowered = model.lower()
    return "sdxl" in lowered or "union" in lowered or "_xl" in lowered or "-xl" in lowered


def _is_union_sdxl_controlnet(model: str) -> bool:
    lowered = model.lower()
    return "union" in lowered and ("sdxl" in lowered or "xl" in lowered)
