import re
from typing import Any


def add_model_override(payload: dict[str, Any], checkpoint: str) -> dict[str, Any]:
    payload["override_settings"] = {"sd_model_checkpoint": checkpoint}
    payload["override_settings_restore_afterwards"] = True
    return payload


async def resolve_checkpoint(a1111_client, preferred: str) -> str:
    models = await a1111_client.get_models()
    candidates = [_model_name(model) for model in models]
    match = select_checkpoint(candidates, preferred)
    if not match:
        available = ", ".join(candidates) or "none"
        raise RuntimeError(f"Checkpoint '{preferred}' is not available in A1111. Available: {available}")
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
