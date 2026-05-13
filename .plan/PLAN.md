# Photo AI Platform – Implementation Plan

## Overview

Nền tảng chỉnh sửa ảnh AI dành cho content creator, ẩn độ phức tạp của A1111.
User chỉ cần chọn style + nhập prompt → hệ thống tự chọn model + tham số tối ưu.

**Stack:**
- Backend: Python FastAPI + PostgreSQL + JWT auth
- Frontend: Next.js + TypeScript + TailwindCSS
- AI Engine: A1111 WebUI local API (localhost:7860)
- Queue: asyncio task queue (simple), có thể nâng lên Celery sau

---

## Architecture

```
User Browser
    │
    ▼
Next.js Frontend (port 3000)
    │  REST API calls
    ▼
FastAPI Backend (port 8000)
    ├── Auth module (JWT)
    ├── Job Queue (async)
    ├── Preset Config (YAML)
    ├── Image Storage (local filesystem)
    └── A1111 API Client
            │
            ▼
    A1111 WebUI API (port 7860)
            │
            ▼
    SD Models (filesystem)

PostgreSQL DB
    ├── users
    ├── jobs (generation history)
    └── images (metadata)
```

---

## Features

| Feature | A1111 Endpoint | Description |
|---------|---------------|-------------|
| Tạo ảnh mới | `/sdapi/v1/txt2img` | Text → Image |
| Chỉnh sửa ảnh | `/sdapi/v1/img2img` | Image + prompt → edited image |
| Upscale ảnh | `/sdapi/v1/extra-single-image` | Image → higher res |
| Mở rộng ảnh | `/sdapi/v1/img2img` (outpainting mask) | Expand canvas |

---

## Style Presets & Model Mapping

### Available Models (hiện có)
| Model | Style | Dùng cho |
|-------|-------|---------|
| `realismIllustriousBy_v55FP16` | Realistic | txt2img, img2img, upscale |
| `v1-5-pruned-emaonly` | General | fallback / test |

---

### 🎨 Models theo phong cách – chọn 1 model/style

> **Mỗi style chỉ cần 1 model được activate trong A1111. Có thể đổi bất cứ lúc nào bằng cách sửa `config.yaml`.**

#### 📷 Realistic / Photographic
Dùng cho ảnh chân thực, portrait, phong cảnh thực tế.

| Model | Điểm nổi bật | SD Base | CivitAI |
|-------|-------------|---------|---------|
| `realismIllustriousBy_v55FP16` ✅ | Đã có sẵn, chất lượng tốt | 1.5 | — |
| **`Realistic Vision V6.0`** ⭐ | Phổ biến nhất, face + detail xuất sắc | 1.5 | [link](https://civitai.com/models/4201) |
| `Absolute Reality v1.8` | Sharp color, good for portrait | 1.5 | [link](https://civitai.com/models/81435) |
| `epiCRealism` | Fashion, portrait, commercial | 1.5 | [link](https://civitai.com/models/25694) |
| `CyberRealistic v4.3` | Cinematic realism | 1.5 | CivitAI |

#### 🎴 Anime / Illustration
Dùng cho ảnh phong cách anime, manga, cartoon.

| Model | Điểm nổi bật | SD Base | CivitAI |
|-------|-------------|---------|---------|
| **`Anything V5`** ⭐ | Classic, stable, versatile | 1.5 | [link](https://civitai.com/models/9409) |
| `Counterfeit V3.0` | Cinematic anime, highly detailed | 1.5 | [link](https://civitai.com/models/37687) |
| `MeinaMix V11` | Vibrant, great for characters | 1.5 | [link](https://civitai.com/models/72446) |
| `GhostMix V2.0` | Semi-realistic anime | 1.5 | CivitAI |
| **`Animagine XL 3.0`** ⭐ (XL) | Best hands, character integration | SDXL | [link](https://civitai.com/models/94040) |
| `Pony Diffusion XL V6` | Manga/anime, tag control cực tốt | SDXL | [link](https://civitai.com/models/257749) |

#### 🛍️ Advertisement / Commercial / Product
Dùng cho ảnh sản phẩm, quảng cáo, thương mại.

| Model | Điểm nổi bật | SD Base | CivitAI |
|-------|-------------|---------|---------|
| **`Juggernaut XL v9`** ⭐ | #1 cho product shot, ultra-realistic | SDXL | [link](https://civitai.com/models/133005) |
| `RealVisXL V4.0` | Studio lighting, clean product | SDXL | CivitAI |
| `DreamShaper XL Lightning` | Artistic + realism blend | SDXL | [link](https://civitai.com/models/177105) |
| `LEOSAM HelloWorld XL` | Product photography chuyên dụng | SDXL | CivitAI |

#### 🎭 Semi-Realistic / Portrait (Bonus style)
Dùng cho portrait ảnh người, chân dung đẹp, phong cách Á Đông.

| Model | Điểm nổi bật | SD Base | CivitAI |
|-------|-------------|---------|---------|
| `ChilloutMix` | Asian portrait, skincare-level detail | 1.5 | CivitAI |
| `Beautiful Realistic Asians V7` | Asian portrait chuyên dụng | 1.5 | CivitAI |
| `MajicMix Realistic` | Balanced portrait, commercial-ready | 1.5 | CivitAI |

#### 🎨 Artistic / Fantasy (Bonus style)
Dùng cho ảnh nghệ thuật, fantasy, concept art.

| Model | Điểm nổi bật | SD Base | CivitAI |
|-------|-------------|---------|---------|
| `DreamShaper V8` | Versatile, artistic, fantasy | 1.5 | CivitAI |
| `Deliberate V3` | Detailed fantasy/concept art | 1.5 | CivitAI |
| `Protogen X3.4` | Sci-fi, cyberpunk, mixed | 1.5 | CivitAI |

---

### 🔍 Upscaler Models (cần download riêng)
| Model | Dùng cho | Link |
|-------|---------|------|
| **`4x-UltraSharp`** ⭐ | Ảnh thực, sắc nét | [Github](https://github.com/Ceyase/4x-UltraSharp) |
| `R-ESRGAN 4x+` | General (built-in A1111) | Tự động có |
| `R-ESRGAN 4x+ Anime6B` | Anime upscale | Built-in A1111 |
| `4x-NMKD-Siax_200k` | Photorealistic | CivitAI |

---

### ⚠️ Lưu ý SD 1.5 vs SDXL
- **SD 1.5 models** (Anything V5, Realistic Vision...): nhẹ hơn, nhanh hơn, dùng ít VRAM hơn (~4-6GB)
- **SDXL models** (Juggernaut XL, Animagine XL...): chất lượng cao hơn, cần VRAM ~8-12GB, chậm hơn
- Hệ thống backend cần biết model là 1.5 hay XL để set đúng `width/height` mặc định (512/768 cho 1.5, 1024/1024 cho XL)

### Preset Config Structure (YAML)
```yaml
presets:
  txt2img:
    realistic:
      model: realismIllustriousBy_v55FP16
      steps: 30
      cfg_scale: 7
      sampler: DPM++ 2M Karras
      width: 768
      height: 1024
      base_positive: "masterpiece, best quality, ultra detailed, photorealistic, 8k"
      base_negative: "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry"
    anime:
      model: anything-v5
      steps: 28
      cfg_scale: 7.5
      sampler: Euler a
      width: 512
      height: 768
      base_positive: "masterpiece, best quality, anime style, detailed, beautiful"
      base_negative: "nsfw, lowres, bad anatomy, bad hands, text, watermark, blurry, realistic"
    advertisement:
      model: juggernautXL
      steps: 35
      cfg_scale: 6.5
      sampler: DPM++ 2M Karras
      width: 1024
      height: 1024
      base_positive: "commercial photography, product shot, studio lighting, clean background, professional, 4k"
      base_negative: "nsfw, amateur, low quality, blurry, noise, distortion"
  img2img:
    realistic:
      model: realismIllustriousBy_v55FP16
      denoising_strength: 0.55
      steps: 30
      cfg_scale: 7
      # ... same pattern
    anime:
      model: anything-v5
      denoising_strength: 0.6
      # ...
  upscale:
    upscaler: R-ESRGAN 4x+
    scale: 4
    gfpgan_visibility: 0.5  # face restore
  outpaint:
    realistic:
      model: realismIllustriousBy_v55FP16
      denoising_strength: 0.85
      steps: 35
      fill_mode: 1  # fill
```

---

## Project Structure

```
photo-ai/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/          # SQLAlchemy models
│   │   │   ├── user.py
│   │   │   ├── job.py
│   │   │   └── image.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── generate.py  # txt2img
│   │   │   ├── edit.py      # img2img
│   │   │   ├── upscale.py
│   │   │   └── outpaint.py
│   │   ├── services/
│   │   │   ├── a1111_client.py   # A1111 API wrapper
│   │   │   ├── preset_service.py # load & merge presets
│   │   │   ├── job_service.py    # async job management
│   │   │   └── storage_service.py
│   │   └── presets/
│   │       └── config.yaml
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   └── register/page.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx         # main tabs
│   │   │   │   ├── generate/page.tsx
│   │   │   │   ├── edit/page.tsx
│   │   │   │   ├── upscale/page.tsx
│   │   │   │   ├── outpaint/page.tsx
│   │   │   │   └── history/page.tsx
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── StyleSelector.tsx    # Realistic/Anime/Advertisement
│   │   │   ├── PromptInput.tsx
│   │   │   ├── ImageUpload.tsx
│   │   │   ├── ImageResult.tsx
│   │   │   ├── JobStatus.tsx        # polling progress
│   │   │   └── HistoryGrid.tsx
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   └── auth.ts
│   │   └── types/
│   │       └── index.ts
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

---

## DB Schema

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  username VARCHAR UNIQUE NOT NULL,
  hashed_password VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- jobs (generation tasks)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  feature VARCHAR NOT NULL,  -- txt2img | img2img | upscale | outpaint
  style VARCHAR,             -- realistic | anime | advertisement
  user_prompt TEXT,
  status VARCHAR DEFAULT 'pending',  -- pending | processing | done | failed
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- images
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  user_id UUID REFERENCES users(id),
  type VARCHAR,  -- input | output
  file_path VARCHAR NOT NULL,
  filename VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints (Backend)

### Auth
- `POST /auth/register`
- `POST /auth/login` → JWT token
- `GET /auth/me`

### Generation (all require JWT)
- `POST /api/generate` – txt2img `{prompt, style}`
- `POST /api/edit` – img2img `{prompt, style, image}`
- `POST /api/upscale` – `{image, scale?}`
- `POST /api/outpaint` – `{prompt, style, image, direction: left|right|top|bottom|all}`

### Jobs
- `GET /api/jobs` – list user's jobs (history)
- `GET /api/jobs/{id}` – job status + result

### Images
- `GET /api/images/{filename}` – serve image file

---

## Frontend UX Flow

```
Login/Register
    │
    ▼
Dashboard (tabs: Generate | Edit | Upscale | Expand | History)
    │
    ├── Generate tab:
    │   ├── StyleSelector (Realistic / Anime / Advertisement)
    │   ├── PromptInput (textarea)
    │   └── [Generate] → JobStatus (polling) → ImageResult
    │
    ├── Edit tab:
    │   ├── ImageUpload (drag & drop)
    │   ├── StyleSelector
    │   ├── PromptInput ("make the sky more dramatic...")
    │   └── [Edit] → JobStatus → ImageResult (before/after)
    │
    ├── Upscale tab:
    │   ├── ImageUpload
    │   └── [Upscale 4x] → JobStatus → ImageResult
    │
    ├── Expand tab:
    │   ├── ImageUpload
    │   ├── DirectionSelector (↑↓←→ or All)
    │   ├── StyleSelector
    │   ├── PromptInput (optional context)
    │   └── [Expand] → JobStatus → ImageResult
    │
    └── History tab:
        └── HistoryGrid (thumbnail + feature + date + download)
```

---

## Implementation Todos (ordered)

> **Last updated:** 2026-05-13 — Session paused after Phase 1 complete + Phase 2 routers written.

### Phase 1 – Backend Foundation ✅ DONE
1. ✅ Setup FastAPI project, dependencies, .env → `backend/app/`, `requirements.txt`, `.env`
2. ✅ PostgreSQL + SQLAlchemy models + Alembic → `models/user.py`, `job.py`, `image.py`, `alembic/`
3. ✅ JWT auth → `routers/auth.py`, `services/auth_service.py`
4. ✅ A1111 client service → `services/a1111_client.py` (txt2img/img2img/upscale/health check)
5. ✅ Preset config loader → `services/preset_service.py` + `presets/config.yaml` (5 styles × 4 features)

### Phase 2 – Core Features ✅ CODE WRITTEN (needs DB + test)
6. ✅ txt2img endpoint → `routers/generate.py`
7. ✅ img2img endpoint → `routers/edit.py`
8. ✅ Upscale endpoint → `routers/upscale.py`
9. ✅ Outpaint endpoint → `routers/outpaint.py` (PIL canvas expand + mask)
10. ✅ Job queue + status polling → `services/job_service.py`, `routers/jobs.py`

> ⚠️ Phase 2 needs: PostgreSQL running + `alembic upgrade head` + A1111 running to test end-to-end.

### Phase 3 – Frontend ⏳ NOT STARTED
11. Next.js setup + TailwindCSS + auth pages
12. Dashboard layout + tab routing
13. Generate tab UI
14. Edit tab UI
15. Upscale tab UI
16. Expand tab UI
17. History tab UI + API integration

### Phase 4 – Polish ⏳ NOT STARTED
18. Image storage (save input/output to disk + serve) ← `storage_service.py` written, wiring needed
19. Error handling + loading states
20. Docker compose (backend + frontend + postgres) ← `backend/Dockerfile` done, compose pending
21. README + setup guide

---

## Files Created So Far

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py           ← FastAPI app entry, CORS, static files
│   ├── config.py         ← env vars
│   ├── database.py       ← SQLAlchemy engine + SessionLocal
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── job.py
│   │   └── image.py
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── auth.py       ← POST /auth/register, /auth/login, GET /auth/me
│   │   ├── generate.py   ← POST /api/generate (txt2img)
│   │   ├── edit.py       ← POST /api/edit (img2img)
│   │   ├── upscale.py    ← POST /api/upscale
│   │   ├── outpaint.py   ← POST /api/outpaint
│   │   └── jobs.py       ← GET /api/jobs, GET /api/jobs/{id}
│   ├── services/
│   │   ├── __init__.py
│   │   ├── a1111_client.py
│   │   ├── auth_service.py
│   │   ├── job_service.py
│   │   ├── preset_service.py
│   │   └── storage_service.py
│   └── presets/
│       └── config.yaml   ← 5 styles × 4 features, full prompt + params
├── alembic/              ← migration setup, env.py patched
├── alembic.ini
├── requirements.txt
├── .env                  ← copied from .env.example
├── .env.example
└── Dockerfile
storage/
├── input/                ← uploaded images saved here
└── output/               ← generated images saved here
```

## Next Session: Resume from Phase 3 (Frontend)

Command to start backend (once PostgreSQL is running):
```bash
cd /home/tieubaoca/AI/photo-ai/backend
pip3 install -r requirements.txt --break-system-packages
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Start A1111 with API enabled:
```bash
cd /home/tieubaoca/AI/stable-diffusion-webui
./webui.sh --api --listen
```

---

## Notes

- A1111 phải chạy với flag `--api` để expose REST API
- Async job: submit job → return job_id → frontend polls `/api/jobs/{id}`
- Outpaint dùng img2img với mask (fill canvas trước, mask phần mở rộng)
- Models anime + advertisement cần download thêm trước khi feature đó hoạt động
- A1111 cần `--api --listen` để backend gọi được từ container Docker
