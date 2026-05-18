# Photo AI Model Download Plan

This note records the recommended A1111 models for Photo AI so the project can avoid mixing incompatible checkpoints and feature models.

## Current A1111 Inventory

Observed on the local A1111 instance during the live full-flow review:

- Checkpoints:
  - `anything-v5`
  - `chilloutmix_NiPrunedFp32Fix`
  - `Juggernaut-XL_v9_RunDiffusionPhoto_v2`
  - `realismIllustriousBy_v55FP16`
  - `v1-5-pruned-emaonly`
  - `v15PrunedEmaonly_v15PrunedEmaonly`
- ControlNet models:
  - `control_v11f1e_sd15_tile`
  - `control_v11f1p_sd15_depth`
  - `control_v11p_sd15_canny`
  - `control_v11p_sd15_inpaint`
  - `control_v11p_sd15_openpose`
- SAM models:
  - `sam_vit_b_01ec64.pth`
- ADetailer models:
  - `face_yolov8s.pt`
  - `hand_yolov8s.pt`
- Upscalers:
  - `R-ESRGAN 4x+`
  - `R-ESRGAN 4x+ Anime6B`
  - `4x-UltraSharp`
  - `SwinIR 4x`
  - `DAT x2/x3/x4`

## Main Compatibility Rule

Do not use SDXL checkpoints with SD1.5 ControlNet models.

The backend currently contains a fallback that moves ControlNet jobs to an SD1.5 checkpoint when only SD1.5 ControlNet models are installed. That keeps jobs from failing, but quality is not optimal. The better long-term fix is to install matching ControlNet models for each checkpoint family and select by `sd_version`.

## Priority Downloads

### P0 - Required For Correct Feature Quality

Install these first.

#### Missing SD1.5 ControlNet Sketch Models

Download into:

```text
$HOME/AI/stable-diffusion-webui/extensions/sd-webui-controlnet/models/
```

Models:

- `control_v11p_sd15_scribble.pth`
- `control_v11p_sd15_lineart.pth`
- `control_v11p_sd15s2_lineart_anime.pth`

Why:

- `sketch-to-photo` currently falls back to Canny when Scribble or Lineart is unavailable.
- Canny can pass tests but gives weaker results for drawings, manga line art, and freehand sketches.

Reference:

- https://huggingface.co/lllyasviel/ControlNet-v1-1/tree/main

#### General SD1.5 Photoreal Checkpoint For ControlNet

Download one strong SD1.5 photoreal checkpoint:

- `Realistic Vision V6.0 B1`
- `epiCRealism`
- `AbsoluteReality v1.8.1`

Use it for:

- `generate/reference`
- `edit` with ControlNet
- `pose-control`
- `depth-guide`
- realistic `sketch-to-photo`
- SD1.5 inpaint/outpaint/background replacement flows

Why:

- The installed ControlNet set is SD1.5.
- `chilloutmix_NiPrunedFp32Fix` works as a fallback but is portrait-biased, especially for Asian portrait aesthetics.
- A general SD1.5 photoreal checkpoint is safer for product, object, architecture, pose, depth, and background work.

#### Better SAM Model

Download into:

```text
$HOME/AI/stable-diffusion-webui/models/sam/
```

Preferred:

- `sam_vit_h_4b8939.pth`

Alternative:

- `sam_vit_l_0b3195.pth`

Keep:

- `sam_vit_b_01ec64.pth` for faster, lower-memory runs.

Why:

- `sam_vit_b` is fast but can produce weaker subject masks.
- `sam_vit_h` usually gives better masks for background replacement.

Reference:

- https://github.com/facebookresearch/segment-anything

### P1 - Recommended For SDXL Quality

Install these if the project should keep SDXL quality for advertisement/product and high-end photoreal flows.

#### SDXL ControlNet

Recommended compact option:

- `xinsir/controlnet-union-sdxl-1.0`

Feature-specific alternatives:

- SDXL Canny
- SDXL Depth
- SDXL OpenPose
- SDXL Scribble
- SDXL Tile
- SDXL Inpaint

Why:

- `Juggernaut-XL_v9_RunDiffusionPhoto_v2` is good for commercial/product generation.
- Without SDXL ControlNet, backend must fallback to SD1.5 for ControlNet features, lowering quality and style consistency.

Reference:

- https://huggingface.co/xinsir/controlnet-union-sdxl-1.0

#### Additional SDXL Photoreal Checkpoint

Optional:

- `RealVisXL V5.0`

Use it for:

- realistic SDXL generation
- portrait SDXL generation
- high-quality img2img

Note:

- Lightning/Turbo variants need separate presets with low steps and low CFG. Do not reuse the current 30-step CFG 7 presets.

Reference:

- https://civitai.green/models/139562/realvisxl-v50

### P2 - Quality Tuning

#### Upscalers

Existing upscalers are enough for now. Suggested defaults:

- General photo: `R-ESRGAN 4x+`
- Sharper web/social output: `4x-UltraSharp`
- Anime/manga: `R-ESRGAN 4x+ Anime6B`
- Old photo restoration: `R-ESRGAN 4x+` or `SwinIR 4x`

Avoid making `4x-UltraSharp` the universal default because it can introduce halos or harsh edges on old photos.

Reference:

- https://github.com/xinntao/Real-ESRGAN

## Recommended Backend Mapping

### Text To Image

- `realistic`: SDXL `RealVisXL V5.0` or `Juggernaut XL`; use SD1.5 photoreal checkpoint when ControlNet is SD1.5.
- `portrait`: SDXL photoreal for general portraits; `chilloutmix_NiPrunedFp32Fix` only for natural Asian portrait presets.
- `natural`: `chilloutmix_NiPrunedFp32Fix` is acceptable, but keep scope narrow.
- `advertisement`: `Juggernaut-XL_v9_RunDiffusionPhoto_v2`; install SDXL ControlNet if using references.
- `anime`: `anything-v5`; add anime lineart ControlNet for sketch and lineart flows.
- `artistic/sketch/watercolor/oil/noir`: current `v1-5-pruned-emaonly` works as a baseline, but a dedicated art checkpoint such as `DreamShaper 8` would improve quality.

### Image To Image

- Use the same checkpoint family as the input style.
- For low-change variations, keep `denoising_strength` around `0.25-0.4`.
- For restyling, use `0.5-0.65`.

### ControlNet Features

- `generate/reference` and `edit` with `edges`: Canny model matching the checkpoint family.
- `pose-control`: OpenPose model matching the checkpoint family.
- `depth-guide`: Depth model matching the checkpoint family.
- `sketch-to-photo`:
  - freehand sketch: Scribble
  - manga/anime linework: Anime Lineart
  - clean illustration linework: Lineart
- `background replace`, `inpaint`, `outpaint`: use inpaint-capable checkpoint family and matching inpaint ControlNet where possible.

### Face And Hand Repair

Current ADetailer config is acceptable:

- Face: `face_yolov8s.pt`
- Hands: `hand_yolov8s.pt`

Keep denoise conservative:

- Face: around `0.3-0.4`
- Hands: around `0.4-0.5`

## Follow-Up Backend Improvements

After downloading models, update backend model selection instead of relying on name-based fallbacks:

- Add explicit `sd_version` to each preset and checkpoint.
- Add separate config keys for:
  - `sd15_realistic_model`
  - `sdxl_realistic_model`
  - `sd15_controlnet_models`
  - `sdxl_controlnet_models`
- Make `build_controlnet_scripts` select models by both mode and SD version.
- Do not silently fallback from Lineart/Scribble to Canny unless the API response clearly reports the fallback.
- Surface missing model names in `/api/capabilities` so the frontend can disable or warn accurately.
