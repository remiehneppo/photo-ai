# Progress Tracker

> Cập nhật lần cuối: 2026-05-14

## Status

| Phase | Nội dung | Trạng thái |
|-------|---------|-----------|
| Phase 1 | Backend Foundation | ✅ DONE |
| Phase 2 | Core Feature Routers | ✅ Code xong, chưa test E2E |
| Phase 3 | Frontend (Next.js) | ✅ Scaffold + UI/API integration xong, chưa test E2E |
| Phase 4 | Docker + Polish | ⏳ Chưa bắt đầu |

## Todos chi tiết

### ✅ Done
- [x] FastAPI project setup (config, database, models)
- [x] SQLAlchemy models: `users`, `jobs`, `images`
- [x] Alembic migration setup
- [x] JWT Auth: register / login / me
- [x] A1111 async HTTP client (`a1111_client.py`)
- [x] Preset YAML config (5 styles × 4 features)
- [x] Preset service (merge prompt, load preset)
- [x] Router: `POST /api/generate` (txt2img)
- [x] Router: `POST /api/edit` (img2img)
- [x] Router: `POST /api/upscale`
- [x] Router: `POST /api/sharpen` (PIL UnsharpMask)
- [x] Router: `POST /api/outpaint` (PIL mask expand)
- [x] Router: `GET /api/jobs`, `GET /api/jobs/{id}`
- [x] Job progress fields + A1111 `/sdapi/v1/progress` polling (`progress_percent`, step, ETA, estimate)
- [x] Storage service + Job service
- [x] `backend/Dockerfile`
- [x] Backend unit tests for auth, presets, storage, A1111 client, job runner, outpaint canvas, feature routers, and job history

### ✅ Phase 3 – Frontend
- [x] Next.js + TypeScript + TailwindCSS scaffold
- [x] Login / Register pages + JWT storage
- [x] Dashboard layout + tab nav
- [x] Generate tab UI
- [x] Edit tab UI (image upload)
- [x] Upscale tab UI
- [x] Sharpen tab UI
- [x] Expand/Outpaint tab UI
- [x] History tab (grid + download)
- [x] Job status progress bar with step/ETA/estimated wait
- [x] Frontend API client for backend endpoints
- [x] Build/typecheck pass
- [x] Playwright UI smoke tests with mocked backend API (desktop + mobile)

### ⏳ Next up
- [ ] Test frontend E2E with backend + PostgreSQL + A1111 running
- [ ] Validate A1111 progress accuracy during real txt2img/img2img/outpaint jobs
- [ ] Review model download checklist: `.plan/MODEL_DOWNLOAD_CHECKLIST.md`
- [ ] Review next A1111 integration plan: `.plan/NEXT_FEATURE_PLAN.md`
- [ ] Replace raw `<img>` tags with `next/image` or intentionally disable the warning
- [ ] Resolve remaining npm audit moderate warnings if a patched Next release becomes available
- [ ] `docker-compose.yml` (backend + frontend + postgres)
- [ ] Add deeper frontend component/API tests if needed

### ⏳ Phase 4 – Polish
- [ ] `docker-compose.yml` (backend + frontend + postgres)
- [ ] Error handling + loading states frontend
- [ ] README + setup guide

## Cách chạy backend

```bash
# 1. Cài deps
cd backend
pip3 install -r requirements.txt --break-system-packages

# 2. Tạo .env (xem .env.example)
cp .env.example .env

# 3. Chạy migration
alembic upgrade head

# 4. Start server
uvicorn app.main:app --reload --port 8000
```

## Cách chạy backend tests

```bash
cd backend
pytest -q
```

## Cách chạy A1111 với API

```bash
cd /home/tieubaoca/AI/stable-diffusion-webui
./webui.sh --api --listen
```

API docs: http://localhost:8000/docs

## Cách chạy frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

## Cách chạy UI smoke tests

```bash
cd frontend
npm run test:ui
```
