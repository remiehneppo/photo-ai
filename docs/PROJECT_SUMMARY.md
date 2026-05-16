# Photo AI Project Summary

## Purpose

Photo AI is a full-stack image generation and editing application backed by Automatic1111 Stable Diffusion WebUI. The app provides authenticated browser workflows for text-to-image, reference-guided generation, image editing, upscaling, sharpening, outpainting, and history reuse.

## Runtime Services

- Frontend: Next.js app, normally served on `http://localhost:3001` for UI tests.
- Backend: FastAPI app, served on `http://localhost:8000`.
- AI engine: Automatic1111 WebUI API, expected at `http://127.0.0.1:7860`.
- Storage: local `storage/input` and `storage/output` folders for uploaded and generated images.

## Core Features

- Auth: register, login, token persistence, logout, invalid-token redirect.
- Capabilities: backend reports checkpoints, upscalers, ControlNet, ADetailer, and SAM availability from A1111.
- Generate: style-based txt2img, optional ControlNet reference image, optional ADetailer face/hand fixes.
- Edit: img2img with style presets, optional reference ControlNet, output dimension normalization.
- Upscale: default, face-restore, and anime upscaler presets.
- Sharpen: local PIL-based soft/default/strong sharpening.
- Expand: outpaint directions left/right/top/bottom/all with masked canvas expansion.
- History: per-user job list, output downloads, reuse output as input, delete completed/failed jobs only.

## A1111 VRAM Protection

The backend serializes A1111 jobs with a process-level lock so only one AI job runs at a time. Before each A1111-backed job starts, it now asks A1111 to unload the current checkpoint via `/sdapi/v1/unload-checkpoint`. For checkpoint-based jobs, it then explicitly sets and reloads the checkpoint required by the new task before submitting the generation payload.

Relevant configuration:

- `A1111_TIMEOUT_SECONDS`: request timeout for long A1111 jobs. Default: `600`.
- `A1111_OFFLOAD_BEFORE_JOB`: enables pre-job checkpoint unload. Default: `true`.
- `OUTPAINT_MAX_PIXELS`: caps expanded outpaint canvas size before img2img to reduce OOM risk. Default: `786432`.

If unload is unsupported or fails, the backend logs a warning and continues the job. This keeps the cleanup path best-effort rather than turning cleanup into a hard availability dependency.

## Live Browser Test

The live browser matrix is implemented in `frontend/tests/ui/live-photo-ai.spec.ts`. It uses the real frontend, backend, and A1111 services, creates a fresh test account, submits one A1111 job at a time, health-gates before and after every A1111 job, and writes evidence to `.context/live-browser-test-report.json`.

Latest verified run:

- Command: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/tieubaoca/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome npx playwright test tests/ui/live-photo-ai.spec.ts --project chromium-desktop --reporter=line`
- Result: `51 PASS / 0 FAIL / 0 SKIP`
- Health gates: `79`
- Unexpected console errors: `0`
- Unexpected network errors: `0`
- A1111 capabilities observed: 6 checkpoints, 13 upscalers, ControlNet, ADetailer, SAM, 5 ControlNet models.

## Verification Commands

```bash
pytest backend/tests/test_a1111_client.py backend/tests/test_job_service.py backend/tests/test_outpaint.py
cd frontend && npm run lint
cd frontend && PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/tieubaoca/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome npx playwright test tests/ui/live-photo-ai.spec.ts --project chromium-desktop --reporter=line
```

Known lint warnings are existing Next.js warnings for plain `<img>` usage in image rendering components.
