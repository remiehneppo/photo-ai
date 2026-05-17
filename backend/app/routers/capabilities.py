import time
from pydantic import BaseModel
from fastapi import APIRouter

from app.services.a1111_client import a1111

router = APIRouter(prefix="/api/capabilities", tags=["capabilities"])

_capabilities_cache: dict = {}
_CACHE_TTL_SECONDS = 30


class CapabilityResponse(BaseModel):
    a1111_connected: bool
    checkpoints: list[str]
    upscalers: list[str]
    samplers: list[str]
    extensions: list[str]
    controlnet_available: bool
    controlnet_models: list[str]
    adetailer_available: bool
    sam_available: bool


@router.get("", response_model=CapabilityResponse)
async def get_capabilities():
    now = time.monotonic()
    if _capabilities_cache.get("ts") and now - _capabilities_cache["ts"] < _CACHE_TTL_SECONDS:
        return _capabilities_cache["data"]

    result = await _fetch_capabilities()
    _capabilities_cache["ts"] = now
    _capabilities_cache["data"] = result
    return result


async def _fetch_capabilities() -> CapabilityResponse:
    checkpoints: list[str] = []
    upscalers: list[str] = []
    samplers: list[str] = []
    extensions: list[str] = []
    controlnet_models: list[str] = []
    sam_heartbeat = False

    try:
        raw_models = await a1111.get_models()
        checkpoints = [_model_name(model) for model in raw_models]
        raw_upscalers = await a1111.get_upscalers()
        upscalers = [_named_item(upscaler) for upscaler in raw_upscalers]
        raw_samplers = await a1111.get_samplers()
        samplers = [_named_item(s) for s in raw_samplers]
        raw_extensions = await a1111.get_extensions()
        extensions = [_extension_name(extension) for extension in raw_extensions]
    except Exception:
        return CapabilityResponse(
            a1111_connected=False,
            checkpoints=[],
            upscalers=[],
            samplers=[],
            extensions=[],
            controlnet_available=False,
            controlnet_models=[],
            adetailer_available=False,
            sam_available=False,
        )

    controlnet_available = any("controlnet" in extension.lower() for extension in extensions)
    if controlnet_available:
        try:
            controlnet_models = await a1111.get_controlnet_models()
        except Exception:
            controlnet_models = []

    extension_names = " ".join(extensions).lower()
    adetailer_available = "adetailer" in extension_names
    sam_available = "segment-anything" in extension_names or "inpaint-anything" in extension_names
    if sam_available:
        sam_heartbeat = await a1111.sam_heartbeat()

    return CapabilityResponse(
        a1111_connected=True,
        checkpoints=checkpoints,
        upscalers=upscalers,
        samplers=samplers,
        extensions=extensions,
        controlnet_available=controlnet_available,
        controlnet_models=controlnet_models,
        adetailer_available=adetailer_available,
        sam_available=sam_available and sam_heartbeat,
    )


def _model_name(model: dict) -> str:
    return str(model.get("model_name") or model.get("title") or model.get("name") or "")


def _named_item(item: dict) -> str:
    return str(item.get("name") or item.get("model_name") or item.get("title") or "")


def _extension_name(extension: dict) -> str:
    return str(extension.get("name") or extension.get("extension") or "")
