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
    },
    "lineart": {
        "label": "Lineart / Anime",
        "module": "lineart_anime",
        "model_keyword": "lineart",
        "processor_res": 512,
    },
}


async def build_controlnet_scripts(
    a1111_client: Any,
    image_b64: str,
    mode: str,
    weight: float = 0.7,
) -> dict[str, Any]:
    if mode not in CONTROLNET_MODES:
        raise ValueError(f"Invalid ControlNet mode. Choose from: {list(CONTROLNET_MODES)}")

    models = await a1111_client.get_controlnet_models()
    model = _select_model(models, CONTROLNET_MODES[mode]["model_keyword"])
    if not model:
        raise RuntimeError(f"Missing ControlNet model for mode: {mode}")

    unit = {
        "enabled": True,
        "image": image_b64,
        "module": CONTROLNET_MODES[mode]["module"],
        "model": model,
        "weight": min(2.0, max(0.0, weight)),
        "resize_mode": "Crop and Resize",
        "processor_res": CONTROLNET_MODES[mode]["processor_res"],
        "guidance_start": 0.0,
        "guidance_end": 1.0,
        "pixel_perfect": True,
        "control_mode": "Balanced",
    }
    if "threshold_a" in CONTROLNET_MODES[mode]:
        unit["threshold_a"] = CONTROLNET_MODES[mode]["threshold_a"]
    if "threshold_b" in CONTROLNET_MODES[mode]:
        unit["threshold_b"] = CONTROLNET_MODES[mode]["threshold_b"]

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


def _select_model(models: list[str], keyword: str) -> str | None:
    for model in models:
        if keyword.lower() in model.lower():
            return model
    return None
