from typing import Any


FACE_MODEL = "face_yolov8s.pt"
HAND_MODEL = "hand_yolov8s.pt"


def build_adetailer_scripts(fix_face: bool = False, fix_hands: bool = False) -> dict[str, Any]:
    args: list[Any] = [True, False]
    if fix_face:
        args.append(_adetailer_args(FACE_MODEL, denoising_strength=0.35))
    if fix_hands:
        args.append(_adetailer_args(HAND_MODEL, denoising_strength=0.45))

    if len(args) == 2:
        return {}

    return {
        "ADetailer": {
            "args": args,
        }
    }


async def has_adetailer(a1111_client: Any) -> bool:
    try:
        extensions = await a1111_client.get_extensions()
    except Exception:
        return False

    names = " ".join(str(extension.get("name") or extension.get("extension") or "") for extension in extensions)
    return "adetailer" in names.lower()


def _adetailer_args(model: str, denoising_strength: float) -> dict[str, Any]:
    return {
        "ad_model": model,
        "ad_tab_enable": True,
        "ad_confidence": 0.3,
        "ad_dilate_erode": 4,
        "ad_mask_blur": 4,
        "ad_denoising_strength": denoising_strength,
        "ad_inpaint_only_masked": True,
        "ad_inpaint_only_masked_padding": 32,
    }
