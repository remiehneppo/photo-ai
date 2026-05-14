# A1111 Model Download Checklist

> Mục tiêu: chuẩn bị model/extension để review và test các tính năng mới trước khi triển khai vào Photo AI.

## Đường dẫn A1111 local

Root A1111:

```bash
/home/tieubaoca/AI/stable-diffusion-webui
```

## 1. ADetailer - auto fix face/hand

Tính năng dùng cho:
- Tự sửa mặt sau khi generate/edit.
- Tự sửa tay nếu ảnh người bị lỗi tay.
- Có thể bật bằng checkbox trong Generate/Edit/Outpaint sau này.

Extension:
- URL: `https://github.com/Bing-su/adetailer.git`
- Cài qua A1111: Extensions -> Install from URL -> paste URL -> Install -> Apply and restart UI.

Model cần tải:
- [ ] `face_yolov8s.pt` - realistic/2D face, chất lượng tốt hơn bản `n`.
- [ ] `hand_yolov8n.pt` - hand detection.
- [ ] `person_yolov8s-seg.pt` - person segmentation, dùng về sau cho workflow người/mẫu.

Copy vào:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/models/adetailer/
```

Nguồn model:
- `https://huggingface.co/Bingsu/adetailer`
- Docs: `https://github.com/Bing-su/adetailer`

## 2. ControlNet SD 1.5 - pose, edge, depth, inpaint, tile

Tính năng dùng cho:
- Giữ pose người từ ảnh reference.
- Giữ bố cục bằng edge/depth.
- Product/background workflow ổn định hơn.
- Upscale có giữ chi tiết bằng tile.
- Inpaint/outpaint có kiểm soát hơn.

Extension:
- URL: `https://github.com/Mikubill/sd-webui-controlnet.git`
- Cài qua A1111: Extensions -> Install from URL -> paste URL -> Install -> Apply and restart UI.

Model cần tải:
- [ ] `control_v11p_sd15_canny` - giữ edge/line/composition.
- [ ] `control_v11f1p_sd15_depth` - giữ chiều sâu/bố cục ảnh.
- [ ] `control_v11p_sd15_openpose` - giữ pose người.
- [ ] `control_v11p_sd15_inpaint` - inpaint/object replace tốt hơn.
- [ ] `control_v11f1e_sd15_tile` - detail upscale/tile refinement.

Copy vào:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/extensions/sd-webui-controlnet/models/
```

Nguồn model:
- `https://github.com/Mikubill/sd-webui-controlnet/wiki/Model-download`
- `https://huggingface.co/lllyasviel/ControlNet-v1-1/tree/main`

## 3. ControlNet SDXL - dùng với Juggernaut XL

Tính năng dùng cho:
- Advertisement/product shot với `Juggernaut XL v9`.
- Giữ pose/depth/canny khi chạy SDXL.

Model cần tải:
- [ ] `xinsir/controlnet-union-sdxl-1.0`

Copy vào:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/extensions/sd-webui-controlnet/models/
```

Nguồn:
- `https://huggingface.co/xinsir/controlnet-union-sdxl-1.0`

Ghi chú:
- Model này nặng. Chỉ tải khi đã sẵn sàng test SDXL ControlNet.
- Nếu VRAM hạn chế, ưu tiên test ControlNet SD 1.5 trước.

## 4. Segment Anything - object remove/replace/background

Tính năng dùng cho:
- Chọn object và xóa.
- Chọn object và thay bằng prompt.
- Tách sản phẩm/người khỏi nền.
- Product background replace.

Extension:
- URL: `https://github.com/continue-revolution/sd-webui-segment-anything.git`
- Cài qua A1111: Extensions -> Install from URL -> paste URL -> Install -> Apply and restart UI.

Model nên chọn 1 trong 2:
- [ ] `sam_hq_vit_l.pth` - chất lượng mask tốt, nặng hơn.
- [ ] `sam_vit_b_01ec64.pth` - nhẹ hơn, phù hợp test ban đầu.

Copy vào một trong hai vị trí, chọn một cách duy nhất:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/models/sam/
```

hoặc:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/extensions/sd-webui-segment-anything/models/sam/
```

Nguồn:
- `https://github.com/continue-revolution/sd-webui-segment-anything`
- `https://huggingface.co/ybelkada/segment-anything/tree/main/checkpoints`
- `https://huggingface.co/lkeab/hq-sam`

## 5. Upscale/detail model

Tính năng dùng cho:
- Upscale ảnh thực sắc nét hơn.
- Kết hợp với ControlNet Tile cho detail upscale.

Model cần tải:
- [ ] `4x-UltraSharp.pth` hoặc `4x-UltraSharp.safetensors`

Copy vào:

```bash
/home/tieubaoca/AI/stable-diffusion-webui/ESRGAN/
```

Nguồn:
- `https://huggingface.co/Kim2091/UltraSharp`

## 6. Thứ tự tải khuyến nghị

1. [ ] ADetailer extension + `face_yolov8s.pt` + `hand_yolov8n.pt`
2. [ ] ControlNet extension + SD 1.5 Canny/Depth/OpenPose
3. [ ] ControlNet SD 1.5 Inpaint/Tile
4. [ ] Segment Anything extension + `sam_vit_b_01ec64.pth` hoặc `sam_hq_vit_l.pth`
5. [ ] `4x-UltraSharp`
6. [ ] SDXL ControlNet Union nếu muốn test với `Juggernaut XL v9`

## 7. Sau khi copy model

Restart A1111:

```bash
cd /home/tieubaoca/AI/stable-diffusion-webui
./webui.sh --api --listen
```

Kiểm tra trong UI:
- ADetailer xuất hiện trong txt2img/img2img.
- ControlNet xuất hiện trong txt2img/img2img.
- ControlNet model dropdown thấy model vừa copy.
- Segment Anything tab/API hoạt động.
- Upscaler dropdown thấy `4x-UltraSharp`.
