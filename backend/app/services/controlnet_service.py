from typing import Any


CONTROLNET_MODES = {
    "edges": {
        "label": "Edges",
        "module": "canny",
        "model_keyword": "canny",
        "processor_res": 512,
        "threshold_a": 100,
        "threshold_b": 200,
        "min_weight": 0.85,
        "control_mode": "ControlNet is more important",
    },
    "depth": {
        "label": "Depth",
        "module": "depth_midas",
        "model_keyword": "depth",
        "processor_res": 512,
        "min_weight": 0.9,
        "control_mode": "ControlNet is more important",
    },
    "pose": {
        "label": "Pose",
        "module": "openpose_full",
        "model_keyword": "openpose",
        "processor_res": 512,
        "min_weight": 1.0,
        "control_mode": "ControlNet is more important",
    },
    "product_layout": {
        "label": "Product layout",
        "module": "reference_only",
        "fixed_model": "None",
        "processor_res": 512,
        "resize_mode": "Just Resize",
        "pixel_perfect": False,
        "guidance_start": 0.0,
        "guidance_end": 1.0,
        "min_weight": 0.85,
        "control_mode": "Balanced",
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
    model = mode_config.get("fixed_model")
    if not model:
        keyword = mode_config.get("model_keyword")
        model = _select_model(models, keyword, prefer_sdxl=prefer_sdxl) if keyword else None
        if not model:
            raise RuntimeError(f"Missing ControlNet model for mode: {mode}")

    unit = _build_unit(image_b64, mode_config, model, weight)
    units = [unit]

    if mode == "product_layout":
        canny_model = _select_model(models, "canny", prefer_sdxl=prefer_sdxl)
        if canny_model:
            units.append(_build_unit(
                image_b64,
                {
                    "module": "canny",
                    "processor_res": 512,
                    "threshold_a": 80,
                    "threshold_b": 180,
                    "guidance_start": 0.0,
                    "guidance_end": 0.85,
                    "control_mode": "Balanced",
                },
                canny_model,
                max(0.45, min(0.75, weight * 0.7)),
            ))

    return {
        "ControlNet": {
            "args": units,
        }
    }


def _build_unit(image_b64: str, mode_config: dict[str, Any], model: str, weight: float) -> dict[str, Any]:
    unit = {
        "enabled": True,
        "image": image_b64,
        "module": mode_config["module"],
        "model": model,
        "weight": min(2.0, max(mode_config.get("min_weight", 0.0), weight)),
        "resize_mode": mode_config.get("resize_mode", "Crop and Resize"),
        "processor_res": mode_config["processor_res"],
        "guidance_start": mode_config.get("guidance_start", 0.0),
        "guidance_end": mode_config.get("guidance_end", 1.0),
        "pixel_perfect": mode_config.get("pixel_perfect", True),
        "control_mode": mode_config.get("control_mode", "Balanced"),
    }
    if "threshold_a" in mode_config:
        unit["threshold_a"] = mode_config["threshold_a"]
    if "threshold_b" in mode_config:
        unit["threshold_b"] = mode_config["threshold_b"]
    return unit


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
    if config.get("fixed_model"):
        return config
    keyword = config.get("model_keyword")
    if keyword and _select_model(models, keyword, prefer_sdxl=prefer_sdxl):
        return config

    for fallback_mode in config.get("fallback_modes", []):
        fallback_config = CONTROLNET_MODES[fallback_mode]
        fallback_keyword = fallback_config.get("model_keyword")
        if fallback_keyword and _select_model(models, fallback_keyword, prefer_sdxl=prefer_sdxl):
            return fallback_config

    return config


def _is_sdxl_controlnet(model: str) -> bool:
    lowered = model.lower()
    return "sdxl" in lowered or "union" in lowered or "_xl" in lowered or "-xl" in lowered


def _is_union_sdxl_controlnet(model: str) -> bool:
    lowered = model.lower()
    return "union" in lowered and ("sdxl" in lowered or "xl" in lowered)
