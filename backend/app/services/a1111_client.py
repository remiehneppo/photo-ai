import base64
import httpx
from typing import Any
from app.config import A1111_BASE_URL


class A1111Client:
    def __init__(self):
        self.base_url = A1111_BASE_URL
        self.timeout = httpx.Timeout(300.0)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.base_url}/sdapi/v1/sd-models")
                return r.status_code == 200
        except Exception:
            return False

    async def set_model(self, model_name: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(
                f"{self.base_url}/sdapi/v1/options",
                json={"sd_model_checkpoint": model_name},
            )

    async def txt2img(self, payload: dict[str, Any]) -> list[str]:
        """Returns list of base64-encoded images."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/txt2img", json=payload)
            r.raise_for_status()
            return r.json()["images"]

    async def img2img(self, payload: dict[str, Any]) -> list[str]:
        """Returns list of base64-encoded images."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/img2img", json=payload)
            r.raise_for_status()
            return r.json()["images"]

    async def upscale(self, payload: dict[str, Any]) -> str:
        """Returns base64-encoded image."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/sdapi/v1/extra-single-image", json=payload)
            r.raise_for_status()
            return r.json()["image"]

    async def get_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/sd-models")
            r.raise_for_status()
            return r.json()

    async def get_upscalers(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{self.base_url}/sdapi/v1/upscalers")
            r.raise_for_status()
            return r.json()

    @staticmethod
    def encode_image(image_bytes: bytes) -> str:
        return base64.b64encode(image_bytes).decode("utf-8")

    @staticmethod
    def decode_image(b64_string: str) -> bytes:
        return base64.b64decode(b64_string)


a1111 = A1111Client()
