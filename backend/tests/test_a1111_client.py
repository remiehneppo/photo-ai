import asyncio

from app.services.a1111_client import A1111Client


class Response:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self.data = data or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("request failed")

    def json(self):
        return self.data


class FakeAsyncClient:
    calls = []

    def __init__(self, timeout=None):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url):
        self.calls.append(("GET", url, None))
        if url.endswith("/progress?skip_current_image=true"):
            return Response(data={"progress": 0.5, "eta_relative": 8, "state": {"sampling_step": 5, "sampling_steps": 10}})
        return Response(data=[{"title": "model"}])

    async def post(self, url, json):
        self.calls.append(("POST", url, json))
        if url.endswith("/txt2img"):
            return Response(data={"images": ["txt"]})
        if url.endswith("/img2img"):
            return Response(data={"images": ["img"]})
        if url.endswith("/extra-single-image"):
            return Response(data={"image": "upscaled"})
        return Response(data={})


def test_a1111_client_calls_expected_endpoints(monkeypatch):
    import app.services.a1111_client as module

    FakeAsyncClient.calls = []
    monkeypatch.setattr(module.httpx, "AsyncClient", FakeAsyncClient)
    client = A1111Client()
    client.base_url = "http://a1111.local"

    assert asyncio.run(client.health_check())
    asyncio.run(client.set_model("model-a"))
    assert asyncio.run(client.txt2img({"prompt": "x"})) == ["txt"]
    assert asyncio.run(client.img2img({"prompt": "x"})) == ["img"]
    assert asyncio.run(client.upscale({"image": "x"})) == "upscaled"
    assert asyncio.run(client.get_progress())["progress"] == 0.5

    assert ("POST", "http://a1111.local/sdapi/v1/options", {"sd_model_checkpoint": "model-a"}) in FakeAsyncClient.calls
    assert ("POST", "http://a1111.local/sdapi/v1/txt2img", {"prompt": "x"}) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/sdapi/v1/progress?skip_current_image=true", None) in FakeAsyncClient.calls


def test_image_encoding_round_trip():
    encoded = A1111Client.encode_image(b"image-bytes")

    assert A1111Client.decode_image(encoded) == b"image-bytes"
