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
        if url.endswith("/sdapi/v1/upscalers"):
            return Response(data=[{"name": "R-ESRGAN 4x+"}])
        if url.endswith("/sdapi/v1/extensions"):
            return Response(data=[{"name": "sd-webui-controlnet"}, {"name": "adetailer"}])
        if url.endswith("/controlnet/model_list"):
            return Response(data={"model_list": ["control_v11p_sd15_canny"]})
        if url.endswith("/sam/heartbeat"):
            return Response(status_code=200, data={"message": "pong"})
        if url.endswith("/sam/sam-model"):
            return Response(data=["sam_vit_b_01ec64.pth"])
        return Response(data=[{"title": "model"}])

    async def post(self, url, json=None):
        self.calls.append(("POST", url, json))
        if url.endswith("/reload-checkpoint"):
            return Response(data={})
        if url.endswith("/txt2img"):
            return Response(data={"images": ["txt"]})
        if url.endswith("/img2img"):
            return Response(data={"images": ["img"]})
        if url.endswith("/extra-single-image"):
            return Response(data={"image": "upscaled"})
        if url.endswith("/extra-batch-images"):
            return Response(data={"images": ["batch-a", {"image": "batch-b"}]})
        return Response(data={})


def test_a1111_client_calls_expected_endpoints(monkeypatch):
    import app.services.a1111_client as module

    FakeAsyncClient.calls = []
    monkeypatch.setattr(module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(module, "A1111_TIMEOUT_SECONDS", 123.0)
    client = A1111Client()
    client.base_url = "http://a1111.local"

    assert client.timeout.read == 123.0
    assert asyncio.run(client.health_check())
    asyncio.run(client.set_model("model-a"))
    asyncio.run(client.load_checkpoint("model-b"))
    images, _seed = asyncio.run(client.txt2img({"prompt": "x"}))
    assert images == ["txt"]
    images, _seed = asyncio.run(client.img2img({"prompt": "x"}))
    assert images == ["img"]
    assert asyncio.run(client.upscale({"image": "x"})) == "upscaled"
    assert asyncio.run(client.upscale_batch({"imageList": []})) == ["batch-a", "batch-b"]
    asyncio.run(client.offload_unused_models())
    asyncio.run(client.cleanup_after_job())
    assert asyncio.run(client.get_progress())["progress"] == 0.5
    assert asyncio.run(client.get_upscalers())[0]["name"] == "R-ESRGAN 4x+"
    assert asyncio.run(client.get_extensions())[0]["name"] == "sd-webui-controlnet"
    assert asyncio.run(client.get_controlnet_models()) == ["control_v11p_sd15_canny"]
    assert asyncio.run(client.sam_heartbeat()) is True
    assert asyncio.run(client.get_sam_models()) == ["sam_vit_b_01ec64.pth"]

    assert ("POST", "http://a1111.local/sdapi/v1/options", {"sd_model_checkpoint": "model-a"}) in FakeAsyncClient.calls
    assert ("POST", "http://a1111.local/sdapi/v1/options", {"sd_model_checkpoint": "model-b"}) in FakeAsyncClient.calls
    assert ("POST", "http://a1111.local/sdapi/v1/reload-checkpoint", None) in FakeAsyncClient.calls
    unload_calls = [call for call in FakeAsyncClient.calls if call == ("POST", "http://a1111.local/sdapi/v1/unload-checkpoint", None)]
    assert len(unload_calls) >= 2
    assert ("POST", "http://a1111.local/sdapi/v1/txt2img", {"prompt": "x"}) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/sdapi/v1/sd-models", None) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/sdapi/v1/progress?skip_current_image=true", None) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/sdapi/v1/extensions", None) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/controlnet/model_list", None) in FakeAsyncClient.calls
    assert ("GET", "http://a1111.local/sam/sam-model", None) in FakeAsyncClient.calls


def test_load_checkpoint_reuses_same_model_and_offloads_before_switch(monkeypatch):
    import app.services.a1111_client as module

    FakeAsyncClient.calls = []
    monkeypatch.setattr(module.httpx, "AsyncClient", FakeAsyncClient)
    client = A1111Client()
    client.base_url = "http://a1111.local"

    asyncio.run(client.load_checkpoint("model-a"))
    asyncio.run(client.load_checkpoint("model-a"))
    asyncio.run(client.load_checkpoint("model-b"))

    set_calls = [call for call in FakeAsyncClient.calls if call[0] == "POST" and call[1].endswith("/sdapi/v1/options")]
    unload_calls = [call for call in FakeAsyncClient.calls if call[0] == "POST" and call[1].endswith("/sdapi/v1/unload-checkpoint")]
    assert set_calls == [
        ("POST", "http://a1111.local/sdapi/v1/options", {"sd_model_checkpoint": "model-a"}),
        ("POST", "http://a1111.local/sdapi/v1/options", {"sd_model_checkpoint": "model-b"}),
    ]
    assert unload_calls == [("POST", "http://a1111.local/sdapi/v1/unload-checkpoint", None)]


def test_image_encoding_round_trip():
    encoded = A1111Client.encode_image(b"image-bytes")

    assert A1111Client.decode_image(encoded) == b"image-bytes"


def test_cleanup_after_job_unloads_checkpoint(monkeypatch):
    import app.services.a1111_client as module

    FakeAsyncClient.calls = []
    monkeypatch.setattr(module.httpx, "AsyncClient", FakeAsyncClient)
    client = A1111Client()
    client.base_url = "http://a1111.local"
    client._loaded_checkpoint = "model-a"

    asyncio.run(client.cleanup_after_job())

    assert client._loaded_checkpoint is None
    assert ("POST", "http://a1111.local/sdapi/v1/unload-checkpoint", None) in FakeAsyncClient.calls
