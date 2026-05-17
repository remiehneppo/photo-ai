# Photo AI – Kế hoạch nâng cấp toàn diện

## Tổng quan

Dự án: FastAPI backend + Next.js frontend + A1111 Stable Diffusion
Tính năng hiện có: txt2img, img2img (edit), inpaint, outpaint, upscale, sharpen, interrogate, ControlNet (trong edit), ADetailer

Kế hoạch chia 2 nhóm lớn:
1. **OPTIMIZE** – sửa lỗi, refactor code hiện tại, cải thiện UX
2. **NEW FEATURES** – thêm tính năng mới tận dụng A1111 API

---

## PHẦN 1: OPTIMIZE (Cải thiện code hiện tại)

### Backend Optimizations

#### OPT-1: Stale job cleanup on startup
**Vấn đề:** Khi server restart, các job có status `pending` / `processing` bị kẹt mãi mãi.
**Fix:** Trong `main.py`, sau `Base.metadata.create_all()`, gọi hàm reset jobs về `failed` với message "Server restarted".
```python
# app/main.py – on_event("startup")
db = SessionLocal()
db.query(Job).filter(Job.status.in_(["pending", "processing"])).update(
    {"status": "failed", "error_message": "Server restarted", "progress_label": "Failed"},
    synchronize_session=False
)
db.commit(); db.close()
```
**Files:** `app/main.py`

---

#### OPT-2: DRY – Extract job creation helper
**Vấn đề:** 7 router đều có ~15 dòng boilerplate tạo Job object giống nhau.
**Fix:** Thêm `create_job(db, user_id, feature, style, user_prompt, total_steps, estimated_seconds)` vào `job_service.py`. Refactor tất cả routers dùng helper này.
**Files:** `app/services/job_service.py`, tất cả routers

---

#### OPT-3: DRY – Extract save_job_result helper
**Vấn đề:** Mỗi router có `db2 = SessionLocal()` block để save input/output Image sau job. Code trùng lặp 7 lần.
**Fix:** Thêm `save_job_images(job_id, user_id, input_path, input_filename, output_path, output_filename, seed=None)` vào `job_service.py`.
**Files:** `app/services/job_service.py`, tất cả routers

---

#### OPT-4: Fix PIL verify() safety
**Vấn đề:** `validate_image_bytes()` gọi `image.verify()` rồi tiếp tục access `image.size` và `image.format` trên cùng object. Theo PIL docs, sau `verify()` object không nên dùng tiếp.
**Fix:** Mở image 2 lần – lần 1 để `verify()`, lần 2 để lấy size/format.
```python
with PILImage.open(BytesIO(image_bytes)) as img:
    img.verify()  # validates data integrity
with PILImage.open(BytesIO(image_bytes)) as img:
    image_format = img.format
    width, height = img.size
```
**Files:** `app/services/upload_service.py`

---

#### OPT-5: Fix save_upload file extension
**Vấn đề:** `save_upload()` hardcode suffix `.png` cho mọi file upload, kể cả JPEG/WEBP.
**Fix:** Detect format từ PIL và dùng extension tương ứng: `{"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}`.
**Files:** `app/services/storage_service.py`

---

#### OPT-6: Shared image utility helpers
**Vấn đề:** `ensure_image_size()` trong `edit.py` và `_ensure_png()` trong `inpaint.py` là local functions không được share.
**Fix:** Move cả hai vào `app/services/image_utils.py` (file mới). Import từ đó trong các routers.
**Files:** `app/services/image_utils.py` (mới), `app/routers/edit.py`, `app/routers/inpaint.py`

---

#### OPT-7: Job cancellation race condition
**Vấn đề:** `POST /api/jobs/{id}/cancel` gọi `a1111.interrupt()` – đây là global interrupt, có thể interrupt job của user khác nếu 2 user cùng chạy.
**Fix:** 
- Thêm tracking job hiện tại đang chạy (per-feature hoặc global) 
- Chỉ gọi interrupt nếu job đang cancel thực sự là job đang chạy trên A1111
- Với pending jobs (chưa vào lock): set flag `cancellation_requested` trước, check trong `run_job` trước khi acquire lock
**Files:** `app/services/job_service.py`, `app/routers/jobs.py`

---

#### OPT-8: Per-user concurrent job limit (rate limiting)
**Vấn đề:** Không có giới hạn – user có thể spam queue không giới hạn.
**Fix:** Trong mỗi router, trước khi tạo job, check:
```python
active_count = db.query(Job).filter(
    Job.user_id == user.id,
    Job.status.in_(["pending", "processing"])
).count()
if active_count >= MAX_CONCURRENT_JOBS_PER_USER:
    raise HTTPException(429, "Too many active jobs")
```
Thêm `MAX_CONCURRENT_JOBS_PER_USER = 2` vào `config.py`.
**Files:** `app/config.py`, tất cả routers (hoặc dependency injection)

---

#### OPT-9: SSE endpoint cho real-time job progress
**Vấn đề:** Client phải poll `GET /api/jobs/{id}` liên tục để cập nhật progress. Tốn request không cần thiết.
**Fix:** Thêm `GET /api/jobs/{id}/stream` dùng Server-Sent Events (SSE):
```python
from fastapi.responses import StreamingResponse
async def job_stream(job_id: str, ...):
    async def generate():
        while True:
            job = db.query(Job).filter(Job.id == job_id).first()
            yield f"data: {job.to_json()}\n\n"
            if job.status in ("done", "failed"):
                break
            await asyncio.sleep(1.0)
    return StreamingResponse(generate(), media_type="text/event-stream")
```
Frontend update JobStatus component để dùng EventSource.
**Files:** `app/routers/jobs.py`, `frontend/src/components/JobStatus.tsx`, `frontend/src/lib/api.ts`

---

#### OPT-10: Job list với total count
**Vấn đề:** `GET /api/jobs` trả list nhưng không có total count → frontend không biết có còn trang tiếp theo không.
**Fix:** Thêm response model `{"items": [...], "total": N, "skip": N, "limit": N}` hoặc `X-Total-Count` header.
**Files:** `app/routers/jobs.py`

---

#### OPT-11: Structured logging cho jobs
**Vấn đề:** Log hiện tại chỉ có exception message, thiếu context (feature, style, duration, user_id).
**Fix:** Thêm log entries:
- `job_started feature=X style=Y user_id=Z`
- `job_completed feature=X duration_ms=N`
- `job_failed feature=X error=Y duration_ms=N`
- Log A1111 request timing trong `a1111_client.py`
**Files:** `app/services/job_service.py`, `app/services/a1111_client.py`

---

### Frontend Optimizations

#### UI-1: Image download button
**Vấn đề:** Không có nút download – user phải chuột phải → save.
**Fix:** Thêm download button vào `ImageResult.tsx` và `HistoryGrid.tsx`. Dùng `<a href={url} download>`.
**Files:** `frontend/src/components/ImageResult.tsx`, `frontend/src/components/HistoryGrid.tsx`

---

#### UI-2: Seed display & "Regenerate with seed"
**Vấn đề:** Job có lưu seed nhưng UI không hiển thị. Không thể reproduce kết quả.
**Fix:**
- Hiển thị seed value trong JobDetail sau khi complete
- Thêm nút "🎲 Dùng seed này" – pre-fill seed input với giá trị từ job trước
**Files:** `frontend/src/app/dashboard/page.tsx`, `frontend/src/components/JobStatus.tsx`

---

#### UI-3: "Dùng làm ảnh đầu vào" từ history
**Vấn đề:** User phải download → upload lại để dùng output làm input cho operation tiếp theo.
**Fix:** Thêm button "Dùng để Edit / Inpaint / Upscale" trên output image trong HistoryGrid. Click → chuyển sang tab tương ứng, pre-load ảnh đó.
**Files:** `frontend/src/components/HistoryGrid.tsx`, `frontend/src/app/dashboard/page.tsx`

---

#### UI-4: Before/after comparison slider
**Vấn đề:** Không có cách so sánh input và output side-by-side.
**Fix:** Thêm `ComparisonSlider.tsx` component – kéo slider để reveal input/output. Dùng trong ImageResult khi có cả input và output.
**Files:** `frontend/src/components/ComparisonSlider.tsx` (mới), `frontend/src/components/ImageResult.tsx`

---

#### UI-5: History filtering by feature
**Vấn đề:** HistoryGrid hiển thị tất cả jobs không phân loại.
**Fix:** Thêm filter tabs: All / Generate / Edit / Inpaint / Upscale / Outpaint
**Files:** `frontend/src/components/HistoryGrid.tsx`

---

#### UI-6: Drag-and-drop upload
**Vấn đề:** `ImageUpload` chỉ có click-to-select, không có drag & drop.
**Fix:** Thêm drag-and-drop zone vào `ImageUpload.tsx` dùng HTML5 drag events.
**Files:** `frontend/src/components/ImageUpload.tsx`

---

#### UI-7: Capability-aware UI
**Vấn đề:** Nếu A1111 không kết nối hoặc extension không có (ControlNet, ADetailer), UI vẫn hiển thị các option đó mà không báo lý do fail.
**Fix:** Dùng capabilities API để disable/hide các option khi extension không available. Hiển thị tooltip giải thích.
**Files:** `frontend/src/app/dashboard/page.tsx`, `frontend/src/components/ActionButton.tsx`

---

## PHẦN 2: NEW FEATURES (Tính năng mới)

### Phase 1 – Quick wins (không cần extension mới)

#### F1: Standalone Face Restore
**Mô tả:** Khôi phục khuôn mặt độc lập không kết hợp upscale. Dùng GFPGAN hoặc CodeFormer.
**API A1111:** `POST /sdapi/v1/extra-single-image` với `upscaling_resize=1`, `gfpgan_visibility` / `codeformer_visibility`
**Backend:** `app/routers/face_restore.py` mới
**Frontend:** Tab/card "Face Restore" với slider chọn GFPGAN vs CodeFormer strength
**Preset thêm vào config.yaml:**
```yaml
face_restore:
  gfpgan: { gfpgan_visibility: 0.8, codeformer_visibility: 0.0 }
  codeformer: { gfpgan_visibility: 0.0, codeformer_visibility: 0.8, codeformer_weight: 0.5 }
  combined: { gfpgan_visibility: 0.5, codeformer_visibility: 0.5, codeformer_weight: 0.5 }
```

---

#### F2: Image Variations
**Mô tả:** Tạo nhiều biến thể của ảnh gốc giữ nguyên bố cục, thay đổi chi tiết nhỏ.
**API A1111:** `POST /sdapi/v1/img2img` với `denoising_strength: 0.15–0.40`, batch_size=N
**Backend:** `app/routers/variations.py` mới
**Params:** `denoising_strength` (0.15–0.40), `num_variations` (1–4), style, optional prompt
**Frontend:** Slider strength + số biến thể, hiển thị grid kết quả

---

#### F3: Preset styles mới
**Mô tả:** Thêm các style mới vào `config.yaml` cho cả `txt2img` và `img2img`:
- `vintage` – Retro film look, desaturated, grain
- `noir` – Black & white, high contrast, dramatic shadows  
- `hdr` – High dynamic range, vivid colors, sharp
- `watercolor` – Watercolor painting style
- `oil_painting` – Oil painting texture
- `sketch` – Pencil/charcoal sketch
**Backend:** Chỉ thêm vào `config.yaml` + suggestions cho style mới
**Frontend:** StyleSelector tự động hiển thị styles mới từ API

---

### Phase 2 – ControlNet Standalone

#### F4: Sketch → Photo (ControlNet Scribble/Lineart)
**Mô tả:** Chuyển sketch/lineart thành ảnh thật hoặc anime.
**API A1111:** `POST /sdapi/v1/img2img` với ControlNet module `scribble_hed` hoặc `lineart_anime`
**Backend:**
- Thêm `scribble` và `lineart` vào `CONTROLNET_MODES` trong `controlnet_service.py`
- Router mới `app/routers/sketch_to_photo.py`
**Frontend:** Upload sketch image, chọn style output, prompt

---

#### F5: Pose Control (standalone)
**Mô tả:** Dùng ảnh pose reference để điều hướng tư thế nhân vật trong ảnh mới.
**API A1111:** `POST /sdapi/v1/txt2img` (không phải img2img!) với ControlNet `openpose_full`
**Backend:** Router mới `app/routers/pose_control.py` – nhận pose_image + text prompt, tạo ảnh mới theo pose
**Frontend:** Upload pose reference, text prompt, style

---

#### F6: Depth-guided Generation (standalone)
**Mô tả:** Dùng depth map reference để điều hướng cấu trúc không gian.
**API A1111:** `POST /sdapi/v1/txt2img` với ControlNet `depth_midas`
**Backend:** Router mới `app/routers/depth_guide.py`
**Frontend:** Upload depth/reference image, text prompt, style

---

### Phase 3 – Background Remove & Replace

#### F7: Background Remove & Replace (SAM)
**Mô tả:** Click vào chủ thể trong ảnh → SAM tạo mask → inpaint background mới.
**API A1111 (inpaint-anything extension):**
- `POST /sam/sam-predict` → trả mask từ click point
- `POST /sdapi/v1/img2img` với mask từ SAM
**Backend:**
- `app/services/sam_service.py` mới
- Router `app/routers/background.py` với 2 endpoints:
  - `POST /api/background/segment` – nhận ảnh + click coordinates, trả mask preview
  - `POST /api/background/replace` – nhận ảnh + mask + prompt background mới
**Frontend:**
- `SAMCanvas.tsx` – canvas click-to-select với visual mask overlay
- `BackgroundReplacePanel.tsx` – full workflow UI

---

### Phase 4 – Advanced

#### F8: Old Photo Restoration (pipeline)
**Mô tả:** Pipeline 2 bước: upscale + face restore + img2img với "restore old photo" preset.
**Backend:** Router `app/routers/restore.py` – chạy sequential async tasks
**Config preset mới:**
```yaml
restore:
  default:
    model: realismIllustriousBy_v55FP16
    upscaler_1: R-ESRGAN 4x+
    gfpgan_visibility: 0.7
    denoising_strength: 0.3
    base_positive: "restore, enhance, 4K, sharp, clean, detailed"
    base_negative: "scratches, noise, grain, blur, damage"
```
**Frontend:** Before/after comparison slider, progress steps indicator

---

#### F9: Batch Upscale
**Mô tả:** Upload nhiều ảnh cùng lúc, upscale tất cả trong một job.
**API A1111:** `POST /sdapi/v1/extra-batch-images`
**Backend:** Thêm `upscale_batch()` vào `a1111_client.py`. Router mới `POST /api/upscale/batch`.
**Frontend:** `BatchUpload.tsx` – multi-file drop zone, progress per image

---

#### F10: Color & Tone Adjustment via img2img
**Mô tả:** Thay đổi màu sắc và ánh sáng ảnh qua img2img với denoising thấp (không thay đổi cấu trúc).
**Backend:** Preset mới trong `img2img` section:
- `golden_hour` – warm tones, sunset glow
- `moody_dark` – dark, desaturated, cinematic  
- `vibrant` – vivid saturated colors
- `cool_blue` – cool blue tones, overcast
**Frontend:** Color palette preview thumbnails trong style selector

---

## Kiến trúc thay đổi tổng hợp

### Backend (files mới/sửa)
```
app/
  main.py                    (sửa – startup cleanup)
  config.py                  (sửa – thêm MAX_CONCURRENT_JOBS_PER_USER)
  presets/config.yaml        (sửa – thêm styles, face_restore, restore presets)
  services/
    job_service.py           (sửa – create_job helper, save_job_images, job cancel flag)
    a1111_client.py          (sửa – thêm sam methods, extra_batch, timing logs)
    upload_service.py        (sửa – fix PIL verify() double-open)
    storage_service.py       (sửa – fix file extension detection)
    image_utils.py           (mới – ensure_image_size, ensure_png)
    sam_service.py           (mới – SAM segment anything logic)
    controlnet_service.py    (sửa – thêm scribble/lineart modes)
  routers/
    jobs.py                  (sửa – SSE stream, total count, cancel fix)
    edit.py                  (sửa – use shared helpers, rate limit)
    inpaint.py               (sửa – use shared helpers, rate limit)
    upscale.py               (sửa – thêm /batch endpoint, rate limit)
    face_restore.py          (mới)
    variations.py            (mới)
    sketch_to_photo.py       (mới)
    pose_control.py          (mới)
    depth_guide.py           (mới)
    background.py            (mới – SAM segment + replace)
    restore.py               (mới – pipeline)
```

### Frontend (files mới/sửa)
```
src/
  types/index.ts              (sửa – thêm types mới)
  lib/api.ts                  (sửa – thêm API calls mới, SSE helper)
  components/
    ImageResult.tsx           (sửa – download, compare slider, use-as-input)
    ImageUpload.tsx           (sửa – drag & drop)
    HistoryGrid.tsx           (sửa – filter, download, use-as-input)
    JobStatus.tsx             (sửa – SSE, seed display)
    StyleSelector.tsx         (sửa – color preview for tone styles)
    ComparisonSlider.tsx      (mới – before/after slider)
    SAMCanvas.tsx             (mới – click-to-segment canvas)
    FaceRestorePanel.tsx      (mới)
    VariationsPanel.tsx       (mới)
    BackgroundReplacePanel.tsx(mới)
    BatchUpload.tsx           (mới)
  app/dashboard/page.tsx      (sửa – thêm tabs mới, capability-aware UI)
```

---

## Thứ tự thực hiện (theo ROI)

### Sprint 1 – Bug fixes & DRY (priority cao, ít risk)
1. OPT-1: Startup job cleanup
2. OPT-4: Fix PIL verify()
3. OPT-5: Fix save_upload extension
4. OPT-6: Shared image utils
5. OPT-2: Job creation helper
6. OPT-3: Save job result helper

### Sprint 2 – Backend improvements
7. OPT-8: Per-user rate limiting
8. OPT-7: Job cancellation fix
9. OPT-10: Job list total count
10. OPT-11: Structured logging

### Sprint 3 – Frontend improvements
11. UI-1: Download button
12. UI-2: Seed display & reuse
13. UI-6: Drag & drop upload
14. UI-4: Before/after slider
15. UI-3: Use as input from history
16. UI-5: History filtering
17. UI-7: Capability-aware UI

### Sprint 4 – Quick win features
18. F3: New style presets (vintage, noir, hdr...)
19. F1: Standalone Face Restore
20. F2: Image Variations
21. OPT-9: SSE job progress (kết hợp với F1/F2 để test)

### Sprint 5 – ControlNet standalone
22. F4: Sketch → Photo
23. F5: Pose Control
24. F6: Depth Guide

### Sprint 6 – Advanced features
25. F7: Background Remove & Replace (SAM)
26. F8: Old Photo Restoration pipeline
27. F9: Batch Upscale
28. F10: Color & Tone presets

---

## Ghi chú kỹ thuật

- SAM API path trong inpaint-anything extension: `/sam/sam-predict` (cần verify với instance thực)
- SSE trong FastAPI cần `StreamingResponse` với `media_type="text/event-stream"` và header `Cache-Control: no-cache`
- Batch upscale trả về list images – cần update Image model để hỗ trợ multiple outputs per job (hoặc tạo nhiều Image records)
- ControlNet scribble/lineart modes cần verify model availability qua capabilities check
- Per-user rate limiting nên dùng DB query (không dùng in-memory) để hoạt động đúng với multiple workers
