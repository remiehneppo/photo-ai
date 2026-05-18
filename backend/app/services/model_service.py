import re
from typing import Any


def add_model_override(payload: dict[str, Any], checkpoint: str, clip_skip: int | None = None) -> dict[str, Any]:
    override_settings = {"sd_model_checkpoint": checkpoint}
    if clip_skip is not None:
        override_settings["CLIP_stop_at_last_layers"] = clip_skip
    payload["override_settings"] = override_settings
    payload["override_settings_restore_afterwards"] = True
    return payload


async def resolve_checkpoint(a1111_client, preferred: str | list[str]) -> str:
    models = await a1111_client.get_models()
    candidates = [_model_name(model) for model in models]
    preferred_names = _preferred_names(preferred)
    for preferred_name in preferred_names:
        match = select_checkpoint(candidates, preferred_name)
        if match:
            return match

    available = ", ".join(candidates) or "none"
    requested = ", ".join(preferred_names) or "none"
    raise RuntimeError(f"Checkpoint '{requested}' is not available in A1111. Available: {available}")


async def resolve_controlnet_checkpoint(a1111_client, preferred: str) -> str:
    """Resolve a checkpoint compatible with the installed ControlNet models."""
    raw_models = await a1111_client.get_models()
    candidates = [_model_name(model) for model in raw_models]
    match = select_checkpoint(candidates, preferred)
    if not match:
        available = ", ".join(candidates) or "none"
        raise RuntimeError(f"Checkpoint '{preferred}' is not available in A1111. Available: {available}")

    try:
        controlnet_models = await a1111_client.get_controlnet_models()
    except Exception:
        return match

    if not _requires_sd15_controlnet(controlnet_models) or _looks_like_sd15_checkpoint(match):
        return match

    for fallback in ("chilloutmix_NiPrunedFp32Fix", "v1-5-pruned-emaonly", "v15PrunedEmaonly_v15PrunedEmaonly", "anything-v5"):
        fallback_match = select_checkpoint(candidates, fallback)
        if fallback_match and _looks_like_sd15_checkpoint(fallback_match):
            return fallback_match

    return match


def select_checkpoint(candidates: list[str], preferred: str) -> str | None:
    if not preferred:
        return None

    preferred_norm = _normalize(preferred)
    for candidate in candidates:
        if candidate.lower() == preferred.lower():
            return candidate

    for candidate in candidates:
        if _normalize(candidate) == preferred_norm:
            return candidate

    for candidate in candidates:
        candidate_norm = _normalize(candidate)
        if preferred_norm and (preferred_norm in candidate_norm or candidate_norm in preferred_norm):
            return candidate

    for candidate in candidates:
        if _shared_prefix_len(preferred_norm, _normalize(candidate)) >= 12:
            return candidate

    return None


def _preferred_names(preferred: str | list[str]) -> list[str]:
    if isinstance(preferred, list):
        return [str(name) for name in preferred if str(name).strip()]
    return [str(preferred)] if str(preferred).strip() else []


def _model_name(model: dict[str, Any]) -> str:
    value = str(model.get("model_name") or model.get("title") or model.get("name") or "")
    return value.split(" [", 1)[0].removesuffix(".safetensors").removesuffix(".ckpt")


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _shared_prefix_len(left: str, right: str) -> int:
    count = 0
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        count += 1
    return count


def _requires_sd15_controlnet(models: list[str]) -> bool:
    return any("sd15" in model.lower() or "sd1" in model.lower() for model in models)


def _looks_like_sd15_checkpoint(model_name: str) -> bool:
    normalized = _normalize(model_name)
    if "xl" in normalized or "illustrious" in normalized or "juggernaut" in normalized:
        return False
    return any(token in normalized for token in ("v15", "v1-5", "prunedemaonly", "chilloutmix", "anythingv5"))
