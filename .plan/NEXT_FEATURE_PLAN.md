# Next Feature Plan - A1111 Integrations

> Trạng thái: kế hoạch để review. Chưa triển khai code.

## Nguyên tắc triển khai

- Không expose độ phức tạp của A1111 cho user phổ thông.
- FE chỉ hiển thị workflow rõ ràng: bật/tắt, chọn mode, upload reference nếu cần.
- Backend giữ preset YAML làm nguồn cấu hình chính.
- Mỗi tính năng phải có mock unit/UI tests trước khi E2E thật với A1111.
- Với extension A1111, backend cần health/capability check để FE biết tính năng nào đang khả dụng.

## Phase A - Capability Detection

Trạng thái: DONE.

Mục tiêu:
- Backend đọc trạng thái A1111 và extensions/models đã cài.
- FE có thể disable feature nếu thiếu extension/model.

Backend đề xuất:
- `GET /api/capabilities`
- Trả về:
  - `a1111_connected`
  - `checkpoints`
  - `upscalers`
  - `extensions`
  - `controlnet_models`
  - `adetailer_available`
  - `sam_available`

Lý do làm trước:
- Tránh user bấm feature rồi mới lỗi do thiếu model.
- Hữu ích cho setup/debug.

Đã triển khai:
- Backend route `GET /api/capabilities`.
- A1111 client methods: models, upscalers, extensions, ControlNet models, SAM heartbeat.
- FE dashboard header hiển thị A1111/checkpoint/upscaler/extension summary.
- Backend + frontend mocked UI tests.

## Phase B - ADetailer Auto Fix

Trạng thái: DONE.

Mục tiêu:
- Thêm tùy chọn auto fix face/hand cho generate/edit/outpaint.

User flow:
- Trong Generate/Edit/Expand có checkbox:
  - `Fix face`
  - `Fix hands`
- Mặc định: off.
- Khi bật, backend thêm `alwayson_scripts` cho ADetailer vào payload A1111.

Backend:
- Mở rộng request schema:
  - `fix_face: bool = false`
  - `fix_hands: bool = false`
- Thêm preset:
  - `adetailer.face.model = face_yolov8s.pt`
  - `adetailer.hand.model = hand_yolov8n.pt`
- Build payload `alwayson_scripts`.

Frontend:
- Thêm controls ở Generate/Edit/Expand.
- Disable control nếu `/api/capabilities.adetailer_available = false`.

Tests:
- Unit test payload có ADetailer args khi bật.
- UI test checkbox render và request body có flag.
- E2E test một ảnh portrait realistic.

Rủi ro:
- ADetailer API arg names phụ thuộc version extension.
- Cần test trực tiếp với A1111 sau khi extension đã cài.

Đã triển khai:
- Backend flags `fix_face`, `fix_hands` cho generate/edit/outpaint.
- Backend tự kiểm tra ADetailer extension khi user bật flag.
- ADetailer payload theo `alwayson_scripts.ADetailer.args`.
- FE checkbox `Fix face` / `Fix hands`, tự disable nếu capability báo thiếu ADetailer.
- Unit/UI tests cho payload và controls.

## Phase C - ControlNet Reference

Trạng thái: CODE DONE, chờ copy ControlNet models để E2E thật.

Mục tiêu:
- Cho user upload reference image để giữ pose, edge hoặc depth.

User flow:
- Trong Generate/Edit có section `Reference control`.
- Mode:
  - `Pose`
  - `Edges`
  - `Depth`
  - `Product layout`
- Upload reference image.
- Slider `strength` mặc định 0.7.

Backend:
- Endpoint mới hoặc mở rộng generate/edit:
  - `control_mode`
  - `control_image`
  - `control_weight`
- Build `alwayson_scripts.controlnet.args`.
- Map mode:
  - `pose` -> module `openpose_full`, model `control_v11p_sd15_openpose`
  - `edges` -> module `canny`, model `control_v11p_sd15_canny`
  - `depth` -> module `depth_midas`, model `control_v11f1p_sd15_depth`
  - `product_layout` -> module `canny` hoặc `depth_midas`

Frontend:
- Upload reference image.
- Mode segmented control.
- Strength slider.
- Preview reference image.

Tests:
- Backend test ControlNet payload.
- UI mocked test upload reference.
- E2E realistic SD 1.5 first, SDXL later.

Rủi ro:
- ControlNet SD 1.5 model không dùng được với SDXL checkpoint.
- Cần capability check theo model base: SD 1.5 vs XL.

Đã triển khai:
- Backend helper chọn ControlNet model theo mode: `edges`, `depth`, `pose`, `product_layout`.
- Endpoint multipart `POST /api/generate/reference`.
- `POST /api/edit` nhận thêm optional `control_image`, `control_mode`, `control_weight`.
- FE `Reference control` cho Generate/Edit, tự ẩn upload khi A1111 chưa có ControlNet model.
- Unit/UI tests cho ControlNet payload và reference upload.

Chưa E2E thật:
- `/controlnet/model_list` đang trả `[]`, cần copy model vào `extensions/sd-webui-controlnet/models/`.

## Phase D - Object Remove/Replace

Mục tiêu:
- User upload ảnh, chọn/xác định object, rồi xóa hoặc thay bằng prompt.

MVP user flow:
- Upload image.
- Nhập object prompt: `person`, `background`, `bottle`, `logo`, ...
- Chọn action:
  - `Remove`
  - `Replace`
- Nếu replace thì nhập replacement prompt.

Backend:
- Tích hợp Segment Anything/GroundingDINO nếu API extension ổn định.
- Sinh mask từ object prompt.
- Gọi img2img/inpaint với mask.
- Lưu input, mask preview, output.

Frontend:
- Tab mới `Object`.
- Image upload + object prompt + action.
- Hiển thị mask preview nếu backend trả về.

Tests:
- Mock SAM response + inpaint payload.
- UI flow test.
- E2E test với ảnh đơn giản trước.

Rủi ro:
- API của Segment Anything extension có thể khác version.
- Mask chất lượng không ổn định với prompt mơ hồ.

## Phase E - Product Background Replace

Mục tiêu:
- Workflow riêng cho creator/ecommerce: giữ sản phẩm, đổi nền thương mại.

User flow:
- Upload product image.
- Chọn background preset:
  - `clean studio`
  - `luxury`
  - `outdoor`
  - `social ad`
- Optional prompt.

Backend:
- Dùng SAM để mask product.
- Invert mask để thay background.
- Dùng `Juggernaut XL v9` nếu VRAM đủ; fallback SD 1.5 realistic nếu không.
- Optional ControlNet depth/canny để giữ shape sản phẩm.

Frontend:
- Tab `Product`.
- Preset cards nhỏ.
- Output compare input/output.

Tests:
- Mock mask + inpaint.
- E2E với một ảnh product nhỏ.

Rủi ro:
- Product mask cần refine/feather edge.
- SDXL có thể timeout/VRAM cao.

## Phase F - Detail Upscale

Mục tiêu:
- Nâng cấp upscale hiện tại: vừa scale vừa tái tạo chi tiết tốt hơn.

User flow:
- Tab Upscale thêm mode:
  - `Fast 4x`
  - `Sharp 4x`
  - `Detail restore`
- `Detail restore` dùng ControlNet Tile nếu có.

Backend:
- `Fast 4x`: A1111 extra-single-image hiện tại.
- `Sharp 4x`: `4x-UltraSharp`.
- `Detail restore`: img2img + ControlNet Tile + low denoise.

Frontend:
- Thêm mode selector.
- Hiển thị warning nếu model/extension thiếu.

Tests:
- Unit test payload mode.
- UI test mode selector.
- E2E với ảnh generate sẵn.

Rủi ro:
- Detail restore chậm hơn upscale thường.
- Tile settings cần tinh chỉnh theo VRAM.

## Thứ tự đề xuất để review

1. Phase A - Capability Detection
2. Phase B - ADetailer Auto Fix
3. Phase C - ControlNet Reference
4. Phase F - Detail Upscale
5. Phase D - Object Remove/Replace
6. Phase E - Product Background Replace

Lý do:
- A/B/C tạo nền tảng kỹ thuật cho các workflow sau.
- Detail Upscale tận dụng ControlNet Tile sau khi ControlNet đã ổn.
- Object/Product cần SAM và nhiều xử lý mask hơn, nên để sau.

---

## Phase G – Generation Controls (tham khảo yeri.ai)

> Mục tiêu: Bổ sung các control chi tiết mà yeri.ai có, còn thiếu trong dashboard hiện tại.

### G1. Aspect Ratio / Resolution Selector

- **Backend**: Thêm optional `width`, `height` (hoặc `aspect_ratio` enum) vào `GenerateRequest` & `/api/edit`.
  Ánh xạ preset: `"1:1"→512×512`, `"4:3"→768×576`, `"3:4"→576×768`, `"16:9"→912×512`, `"9:16"→512×912`, `"3:2"→768×512`, `"2:3"→512×768`.
  Override preset width/height nếu user chọn.
- **Frontend**: Component `AspectRatioSelector` (icon grid buttons) trong Generate & Edit tab.

### G2. Negative Prompt

- **Backend**: Thêm `negative_prompt: Optional[str]` vào request. Append vào `preset["base_negative"]`.
- **Frontend**: Textarea "Negative prompt" (collapsible hoặc luôn hiện).

### G3. Advanced Parameters (collapsible panel)

- **Backend**: Thêm optional `steps`, `cfg_scale`, `sampler_name` override vào generate/edit.
  Lấy danh sách sampler từ A1111 `/sdapi/v1/samplers` qua `/api/capabilities`.
- **Frontend**: `<AdvancedPanel>` collapse – steps slider (10–50), CFG slider (1–20), sampler dropdown.

### G4. Batch Generation (N images)

- **Backend**: Thêm `batch_count: int = 1` (max 4). Lặp N lần hoặc dùng `n_iter` trong 1 job.
  Lưu nhiều output images vào job.
- **Frontend**: BatchCountSelector (1/2/4 buttons). ImageResult đã grid-ready.

---

## Phase H – Model & LoRA Control

### H1. Checkpoint Selector

- **Backend**: `/api/capabilities` đã trả về `checkpoints[]`. Thêm `checkpoint: Optional[str]`
  vào generate/edit request, bỏ qua `resolve_checkpoint` khi user chỉ định.
- **Frontend**: Dropdown checkpoint trong Generate/Edit tab (hidden nếu chỉ có 1 model).

### H2. LoRA Selector

- **Backend**: Endpoint mới `GET /api/loras` → gọi A1111 `/sdapi/v1/loras`. Thêm `loras: list[{name, weight}]`
  vào generate request. Inject `<lora:name:weight>` vào prompt.
- **Frontend**: `LoraSelector` component – multi-select với weight slider cho mỗi LoRA.

### H3. Hi-Res Fix (txt2img)

- **Backend**: Thêm optional `enable_hr: bool`, `hr_scale: float`, `hr_upscaler: str` vào generate.
  Thêm vào A1111 payload khi enabled.
- **Frontend**: Toggle "Hi-Res Fix" + scale selector (1.5x / 2x) trong Advanced panel.

---

## Phase I – Tính năng mới (yeri.ai inspired)

### I1. Background Removal Tab (UI)

- Backend router `/api/background` đã hoàn chỉnh (SAM segment + inpaint).
- **Frontend only**: Thêm tab "Background" vào dashboard. Luồng: upload → click để chọn subject
  (point-based SAM) → preview mask → remove/replace background với prompt.

### I2. Prompt Enhancer

- **Backend**: Endpoint `POST /api/enhance-prompt` nhận `{prompt, style}` → làm giàu prompt
  bằng quality tags, style keywords từ preset.
- **Frontend**: Button "✨ Enhance" bên cạnh PromptInput trong Generate tab.

### I3. Image Tiling (Seamless Texture)

- **Backend**: Thêm `tiling: bool = False` vào generate request → thêm `"tiling": True` vào A1111 payload.
- **Frontend**: Checkbox "Seamless tiling" trong Advanced panel.

### I4. Upscaler Selector

- **Backend**: `/api/capabilities` đã trả về `upscalers[]`. Thêm `upscaler: Optional[str]`
  vào upscale request thay vì dùng mode string cố định.
- **Frontend**: Dropdown upscaler thực từ capabilities thay vì hardcode option.

---

## Phase J – UX Polish (yeri.ai style)

### J1. Style Selector Thumbnails

- **Frontend**: Thêm thumbnail URL vào `StyleOption` type. Hiển thị preview ảnh nhỏ trong
  StyleSelector. Ảnh thumbnail lưu trong `/public/styles/`.

### J2. Dashboard Layout – 2-panel

- **Frontend**: Trên màn hình lớn (≥1280px), chia layout: left panel (controls, fixed 380px)
  + right panel (kết quả, chiếm phần còn lại). Hiện tại là stacked form → result.

### J3. Image Lightbox

- **Frontend**: Click vào ảnh output → mở lightbox full-size với navigation, download, copy URL.

### J4. Toast Notifications

- **Frontend**: Replace inline `<p className="text-danger">` bằng toast system (ví dụ `sonner`).
  Success toast khi job done, error toast khi fail.

### J5. History Filter theo Feature

- **Frontend**: Thêm filter theo feature (generate/edit/inpaint/...) vào History tab.
- **Backend**: Thêm `feature` query param vào `GET /api/jobs`.

---

## Phase K – Infrastructure

### K1. Caching Capabilities

- **Backend**: Cache kết quả `/api/capabilities` 30s để tránh gọi A1111 mỗi request.

### K2. Docker Compose nâng cấp

- Thêm `restart: unless-stopped` cho backend service.
- Thêm health check cho A1111 container.

---

## Thứ tự ưu tiên – Phase G→K

1. G1 Aspect Ratio + G2 Negative Prompt + G3 Advanced Params (1 sprint)
2. G4 Batch Generation
3. I1 Background Tab (backend đã sẵn)
4. H1 Checkpoint Selector
5. J2 Layout 2-panel + J3 Lightbox + J4 Toast
6. H2 LoRA Selector + H3 Hi-Res Fix
7. I2 Prompt Enhancer + I3 Tiling + I4 Upscaler Selector
8. J1 Style Thumbnails + J5 History Filter
9. K1/K2 Infrastructure
