import base64
import json
import logging
import time
from typing import Any

import httpx

from app.config import A1111_BASE_URL, A1111_OFFLOAD_BEFORE_JOB, A1111_TIMEOUT_SECONDS

logger = logging.getLogger("photo_ai.a1111")


class A1111Client:
    def __init__(self):
        self.base_url = A1111_BASE_URL
        self.timeout = httpx.Timeout(A1111_TIMEOUT_SECONDS)
        self._loaded_checkpoint: str | None = None

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.base_url}/sdapi/v1/sd-models")
                return r.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            logger.warning("a1111_health_check_failed connection_error")
            return False
        except Exception as e:
            logger.warning("a1111_health_check_failed error=%s", e)
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
        if self._loaded_checkpoint == model_name:
            logger.info("a1111_checkpoint_reuse checkpoint=%s", model_name)
            return
        if self._loaded_checkpoint and self._loaded_checkpoint != model_name:
            await self.offload_unused_models()
        await self.set_model(model_name)
        await self.reload_checkpoint()
        self._loaded_checkpoint = model_name

    async def offload_unused_models(self) -> None:
        """Ask A1111 to unload the active checkpoint when a job finishes."""
        if not A1111_OFFLOAD_BEFORE_JOB:
            return
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/unload-checkpoint")
            self._raise_for_status(r, "unload_checkpoint")
            self._loaded_checkpoint = None

    async def txt2img(self, payload: dict[str, Any]) -> tuple[list[str], int | None]:
        """Returns list of base64-encoded images and the seed used."""
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/txt2img", json=payload)
            self._raise_for_status(r, "txt2img")
            data = r.json()
            logger.info("a1111_txt2img_done duration_ms=%d", int((time.monotonic() - t0) * 1000))
            return data["images"], _extract_seed(data)

    async def img2img(self, payload: dict[str, Any]) -> tuple[list[str], int | None]:
        """Returns list of base64-encoded images and the seed used."""
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/img2img", json=payload)
            self._raise_for_status(r, "img2img")
            data = r.json()
            logger.info("a1111_img2img_done duration_ms=%d", int((time.monotonic() - t0) * 1000))
            return data["images"], _extract_seed(data)

    async def upscale(self, payload: dict[str, Any]) -> str:
        """Returns base64-encoded image."""
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/extra-single-image", json=payload)
            self._raise_for_status(r, "upscale")
            logger.info("a1111_upscale_done duration_ms=%d", int((time.monotonic() - t0) * 1000))
            return r.json()["image"]

    async def upscale_batch(self, payload: dict[str, Any]) -> list[str]:
        """Batch upscale. Returns list of base64-encoded images."""
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/extra-batch-images", json=payload)
            self._raise_for_status(r, "upscale_batch")
            logger.info("a1111_upscale_batch_done duration_ms=%d", int((time.monotonic() - t0) * 1000))
            images = r.json().get("images", [])
            results: list[str] = []
            for image in images:
                if isinstance(image, str):
                    results.append(image)
                elif isinstance(image, dict) and isinstance(image.get("image"), str):
                    results.append(image["image"])
            return results

    async def interrupt(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(f"{self.base_url}/sdapi/v1/interrupt")
        except Exception:
            logger.warning("a1111_interrupt_failed", exc_info=True)

    async def interrogate(self, b64_image: str, model: str = "clip") -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/sdapi/v1/interrogate",
                json={"image": b64_image, "model": model},
            )
            self._raise_for_status(r, "interrogate")
            return r.json()["caption"]

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

    async def get_samplers(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/samplers")
            self._raise_for_status(r, "get_samplers")
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

    async def get_sam_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sam/sam-model")
            self._raise_for_status(r, "get_sam_models")
            data = r.json()
            return [str(model) for model in data] if isinstance(data, list) else []

    async def sam_predict(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Call SAM (inpaint-anything) to get segmentation masks from click points."""
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{self.base_url}/sam/sam-predict", json=payload)
            self._raise_for_status(r, "sam_predict")
            return r.json()

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


def _extract_seed(data: dict[str, Any]) -> int | None:
    try:
        info = json.loads(data.get("info", "{}"))
    except (TypeError, json.JSONDecodeError):
        return None

    seed = info.get("seed")
    if isinstance(seed, list):
        seed = seed[0] if seed else None
    return int(seed) if isinstance(seed, (int, float, str)) and str(seed).strip() else None
