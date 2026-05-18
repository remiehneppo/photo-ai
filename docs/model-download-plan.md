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

### Download Table

Use these paths for the local A1111 install at `$HOME/AI/stable-diffusion-webui`.

| Priority | File | Direct download | Put in A1111 folder | Used by |
| --- | --- | --- | --- | --- |
| P0 | `realisticVisionV60B1_v30VAE-inpainting.safetensors` | https://civitai.com/api/download/models/105723?type=Model&format=SafeTensor | `models/Stable-diffusion/` | photoreal inpaint, outpaint, background replace, restore cleanup |
| P0 | `sd-v1-5-inpainting.ckpt` | https://huggingface.co/runwayml/stable-diffusion-inpainting/resolve/main/sd-v1-5-inpainting.ckpt | `models/Stable-diffusion/` | generic SD1.5 inpaint fallback |
| P0 | `counterfeitV30Fp16_30Inpaint.safetensors` | https://civitai.com/api/download/models/137911?type=Model&format=SafeTensor | `models/Stable-diffusion/` | anime inpaint/outpaint |
| P0 | `juggernautXL_versionXInpaint.safetensors` | https://civitai.com/api/download/models/456538?type=Model&format=SafeTensor | `models/Stable-diffusion/` | SDXL advertisement/product inpaint/outpaint |
| P0 | `dreamshaper_8Inpainting.safetensors` | https://civitai.com/api/download/models/128713?type=Model&format=SafeTensor | `models/Stable-diffusion/` | artistic/creative inpaint/outpaint |
| P0 | `control_v11p_sd15_scribble.pth` | https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_scribble.pth | `extensions/sd-webui-controlnet/models/` | freehand sketch control |
| P0 | `control_v11p_sd15_lineart.pth` | https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_lineart.pth | `extensions/sd-webui-controlnet/models/` | clean lineart control |
| P0 | `control_v11p_sd15s2_lineart_anime.pth` | https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15s2_lineart_anime.pth | `extensions/sd-webui-controlnet/models/` | anime/manga lineart control |
| P0 | `realisticVisionV60B1_v60B1VAE.safetensors` | https://civitai.com/api/download/models/245598?type=Model&format=SafeTensor | `models/Stable-diffusion/` | general SD1.5 photoreal ControlNet flows |
| P0 | `sam_vit_h_4b8939.pth` | https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth | `models/sam/` | best-quality SAM masks |
| P1 | `sam_vit_l_0b3195.pth` | https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth | `models/sam/` | medium-memory SAM masks |
| P1 | `controlnet-union-sdxl-1.0` files | https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/tree/main | `extensions/sd-webui-controlnet/models/` | SDXL Canny/Depth/OpenPose/Inpaint/Tile control |
| P1 | `RealVisXL V5.0` checkpoint | https://civitai.green/models/139562/realvisxl-v50 | `models/Stable-diffusion/` | optional high-quality SDXL photoreal generation |

After downloading checkpoint or ControlNet files, restart A1111 or use the UI refresh button for checkpoints/ControlNet models. CivitAI API links may require a browser session or API token depending on the model's current access policy.

#### Dedicated Inpainting/Outpainting Checkpoints

Download into:

```text
$HOME/AI/stable-diffusion-webui/models/Stable-diffusion/
```

Backend now prefers these names in `backend/app/presets/config.yaml`:

- Photoreal inpaint/outpaint/restore/background replacement: `realisticVisionV60B1_v30VAE-inpainting.safetensors`
- Official generic fallback: `sd-v1-5-inpainting.safetensors`
- Anime inpaint/outpaint: `counterfeitV30Fp16_30Inpaint.safetensors`
- SDXL advertisement/product inpaint/outpaint: `juggernautXL_versionXInpaint.safetensors`
- Creative/artistic inpaint/outpaint: `dreamshaper_8Inpainting.safetensors`

Why:

- Inpaint/outpaint jobs need an inpainting-trained UNet/checkpoint to blend masked regions and canvas extensions.
- Plain txt2img/img2img checkpoints can work, but they more often produce seams, bad masked-region coherence, or style drift.
- The config keeps fallback candidates for the current local machine, but those fallbacks are compatibility paths, not the recommended quality path.

References:

- https://huggingface.co/runwayml/stable-diffusion-inpainting
- https://civitaiarchive.com/models/4201?modelVersionId=105723
- https://civitaiarchive.com/models/115569?modelVersionId=137911
- https://civitaiarchive.com/models/403361/juggernaut-xl-inpainting

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
- Old photo restoration: `SwinIR 4x` plus CodeFormer, with Real-ESRGAN as fallback

Avoid making `4x-UltraSharp` the universal default because it can introduce halos or harsh edges on old photos.

Reference:

- https://github.com/xinntao/Real-ESRGAN
- https://arxiv.org/abs/2108.10257

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

### Inpaint, Outpaint, Background Replace, Restore

Backend priority is now:

- `realistic`, `portrait`, `natural`, `background replace`, `restore`: `realisticVisionV60B1_v30VAE-inpainting`, then `sd-v1-5-inpainting`, then an installed SD1.5 fallback.
- `anime`: `counterfeitV30Fp16_30Inpaint`, then `Counterfeit_V3-inpainting`, then `anything-v5`.
- `advertisement`: `juggernautXL_versionXInpaint`, then `Juggernaut-XL_v9_RunDiffusionPhoto_v2`.
- `artistic`: `dreamshaper_8Inpainting`, then `dreamshaper_8`, then `sd-v1-5-inpainting`, then `v1-5-pruned-emaonly`.
- `restore`: use `SwinIR` + `CodeFormer` before low-denoise img2img cleanup. Avoid using GFPGAN as the default restoration path because it changes identity more aggressively.

### Face And Hand Repair

Current ADetailer config is acceptable:

- Face: `face_yolov8s.pt`
- Hands: `hand_yolov8s.pt`

Keep denoise conservative:

- Face: around `0.3-0.4`
- Hands: around `0.4-0.5`

## Follow-Up Backend Improvements

After downloading models, continue improving backend model selection:

- Add explicit `sd_version` to each preset and checkpoint.
- Add separate config keys for:
  - `sd15_realistic_model`
  - `sdxl_realistic_model`
  - `sd15_controlnet_models`
  - `sdxl_controlnet_models`
- Make `build_controlnet_scripts` select models by both mode and SD version.
- Do not silently fallback from Lineart/Scribble to Canny unless the API response clearly reports the fallback.
- Surface missing model names in `/api/capabilities` so the frontend can disable or warn accurately.
