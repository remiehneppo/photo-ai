# Next Feature Plan - A1111 Integrations

> Trạng thái: kế hoạch để review. Chưa triển khai code.

## Nguyên tắc triển khai

- Không expose độ phức tạp của A1111 cho user phổ thông.
- FE chỉ hiển thị workflow rõ ràng: bật/tắt, chọn mode, upload reference nếu cần.
- Backend giữ preset YAML làm nguồn cấu hình chính.
- Mỗi tính năng phải có mock unit/UI tests trước khi E2E thật với A1111.
- Với extension A1111, backend cần health/capability check để FE biết tính năng nào đang khả dụng.

## Phase A - Capability Detection

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

## Phase B - ADetailer Auto Fix

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

## Phase C - ControlNet Reference

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
