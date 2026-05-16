import base64
import logging
import httpx
from typing import Any
from app.config import A1111_BASE_URL, A1111_OFFLOAD_BEFORE_JOB, A1111_TIMEOUT_SECONDS

logger = logging.getLogger("photo_ai.a1111")


class A1111Client:
    def __init__(self):
        self.base_url = A1111_BASE_URL
        self.timeout = httpx.Timeout(A1111_TIMEOUT_SECONDS)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.base_url}/sdapi/v1/sd-models")
                return r.status_code == 200
        except Exception:
            return False

    async def set_model(self, model_name: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self.base_url}/sdapi/v1/options",
                json={"sd_model_checkpoint": model_name},
            )
            self._raise_for_status(r, "set_model")

    async def reload_checkpoint(self) -> None:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/reload-checkpoint")
            self._raise_for_status(r, "reload_checkpoint")

    async def load_checkpoint(self, model_name: str) -> None:
        await self.set_model(model_name)
        await self.reload_checkpoint()

    async def offload_unused_models(self) -> None:
        """Ask A1111 to unload the active checkpoint before loading the next job's model."""
        if not A1111_OFFLOAD_BEFORE_JOB:
            return
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/unload-checkpoint")
            self._raise_for_status(r, "unload_checkpoint")

    async def txt2img(self, payload: dict[str, Any]) -> list[str]:
        """Returns list of base64-encoded images."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/txt2img", json=payload)
            self._raise_for_status(r, "txt2img")
            return r.json()["images"]

    async def img2img(self, payload: dict[str, Any]) -> list[str]:
        """Returns list of base64-encoded images."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/img2img", json=payload)
            self._raise_for_status(r, "img2img")
            return r.json()["images"]

    async def upscale(self, payload: dict[str, Any]) -> str:
        """Returns base64-encoded image."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/extra-single-image", json=payload)
            self._raise_for_status(r, "upscale")
            return r.json()["image"]

    async def get_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/sd-models")
            self._raise_for_status(r, "get_models")
            return r.json()

    @staticmethod
    def _raise_for_status(response: httpx.Response, operation: str) -> None:
        try:
            response.raise_for_status()
        except Exception:
            logger.exception(
                "a1111_request_failed operation=%s status=%s url=%s response=%s",
                operation,
                getattr(response, "status_code", None),
                getattr(response, "url", ""),
                _short_response_text(response),
            )
            raise

    async def get_upscalers(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/upscalers")
            self._raise_for_status(r, "get_upscalers")
            return r.json()

    async def get_extensions(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/extensions")
            self._raise_for_status(r, "get_extensions")
            return r.json()

    async def get_controlnet_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/controlnet/model_list")
            self._raise_for_status(r, "get_controlnet_models")
            data = r.json()
            return data.get("model_list", []) if isinstance(data, dict) else []

    async def sam_heartbeat(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.base_url}/sam/heartbeat")
                return r.status_code == 200
        except Exception:
            return False

    async def get_progress(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/progress?skip_current_image=true")
            self._raise_for_status(r, "get_progress")
            return r.json()

    @staticmethod
    def encode_image(image_bytes: bytes) -> str:
        return base64.b64encode(image_bytes).decode("utf-8")

    @staticmethod
    def decode_image(b64_string: str) -> bytes:
        return base64.b64decode(b64_string)


a1111 = A1111Client()


def _short_response_text(response: httpx.Response, limit: int = 1000) -> str:
    try:
        text = response.text
    except Exception:
        return "<unavailable>"
    return text[:limit]
