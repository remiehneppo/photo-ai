#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/download-a1111-models.sh [--dry-run] [--check] [--force] [--include-optional] <A1111_ROOT>

Downloads the model set expected by Photo AI into an AUTOMATIC1111 checkout.

Arguments:
  A1111_ROOT          Path to stable-diffusion-webui, for example:
                      $HOME/AI/stable-diffusion-webui

Options:
  --dry-run           Print planned downloads only.
  --check             Print missing/present files and exit without downloading.
  --force             Re-download even when the target file already exists.
  --include-optional  Also download larger optional/fallback models.
  -h, --help          Show this help.

Environment:
  CIVITAI_TOKEN       Optional token for CivitAI gated downloads.
  HF_TOKEN            Optional Hugging Face token for gated downloads.
USAGE
}

dry_run=0
check_only=0
force=0
include_optional=0
a1111_root=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --check)
      check_only=1
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    --include-optional)
      include_optional=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$a1111_root" ]]; then
        echo "Only one A1111_ROOT argument is supported." >&2
        usage >&2
        exit 2
      fi
      a1111_root="$1"
      shift
      ;;
  esac
done

if [[ -z "$a1111_root" ]]; then
  usage >&2
  exit 2
fi

a1111_root="${a1111_root%/}"
if [[ ! -d "$a1111_root" ]]; then
  echo "A1111_ROOT does not exist: $a1111_root" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

append_civitai_token() {
  local url="$1"
  if [[ -n "${CIVITAI_TOKEN:-}" && "$url" == *"civitai.com"* ]]; then
    if [[ "$url" == *"?"* ]]; then
      printf '%s&token=%s' "$url" "$CIVITAI_TOKEN"
    else
      printf '%s?token=%s' "$url" "$CIVITAI_TOKEN"
    fi
  else
    printf '%s' "$url"
  fi
}

download_file() {
  local group="$1"
  local rel_path="$2"
  local url="$3"
  local dest="$a1111_root/$rel_path"
  local dest_dir
  dest_dir="$(dirname "$dest")"

  if [[ -f "$dest" && "$force" -eq 0 ]]; then
    printf '[present] %-16s %s\n' "$group" "$rel_path"
    return 0
  fi

  if [[ "$check_only" -eq 1 ]]; then
    printf '[missing] %-16s %s\n' "$group" "$rel_path"
    return 0
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    printf '[dry-run] %-16s %s <- %s\n' "$group" "$rel_path" "$url"
    return 0
  fi

  mkdir -p "$dest_dir"
  printf '[download] %-15s %s\n' "$group" "$rel_path"

  local resolved_url
  resolved_url="$(append_civitai_token "$url")"

  local curl_args=(
    --location
    --fail
    --retry 5
    --retry-delay 5
    --retry-all-errors
    --continue-at -
    --output "$dest"
  )

  if [[ -n "${HF_TOKEN:-}" && "$url" == *"huggingface.co"* ]]; then
    curl_args+=(--header "Authorization: Bearer ${HF_TOKEN}")
  fi

  curl "${curl_args[@]}" "$resolved_url"
}

run_manifest() {
  local include="$1"
  local group rel_path url optional

  while IFS='|' read -r group rel_path url optional; do
    [[ -z "${group// }" || "${group:0:1}" == "#" ]] && continue
    if [[ "$optional" == "optional" && "$include" -ne 1 ]]; then
      continue
    fi
    download_file "$group" "$rel_path" "$url"
  done <<'MANIFEST'
# group|relative path under A1111 root|download URL|required/optional
checkpoint|models/Stable-diffusion/RealVisXL_V5.0_fp16.safetensors|https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors|required
checkpoint|models/Stable-diffusion/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors|https://civitai.com/api/download/models/348913?type=Model&format=SafeTensor|required
checkpoint|models/Stable-diffusion/v1-5-pruned-emaonly.safetensors|https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors|required
checkpoint|models/Stable-diffusion/anything-v5.safetensors|https://huggingface.co/genai-archive/anything-v5/resolve/main/anything-v5.safetensors|required
checkpoint|models/Stable-diffusion/chilloutmix_NiPrunedFp32Fix.safetensors|https://civitai.com/api/download/models/11745?type=Model&format=SafeTensor|required
checkpoint|models/Stable-diffusion/realisticVisionV60B1_v60B1VAE.safetensors|https://civitai.com/api/download/models/245598?type=Model&format=SafeTensor|required
inpaint|models/Stable-diffusion/realisticVisionV60B1_v30VAE-inpainting.safetensors|https://civitai.com/api/download/models/105723?type=Model&format=SafeTensor|required
inpaint|models/Stable-diffusion/sd-v1-5-inpainting.ckpt|https://huggingface.co/runwayml/stable-diffusion-inpainting/resolve/main/sd-v1-5-inpainting.ckpt|required
inpaint|models/Stable-diffusion/counterfeitV30Fp16_30Inpaint.safetensors|https://civitai.com/api/download/models/137911?type=Model&format=SafeTensor|required
inpaint|models/Stable-diffusion/juggernautXL_versionXInpaint.safetensors|https://civitai.com/api/download/models/456538?type=Model&format=SafeTensor|required
inpaint|models/Stable-diffusion/dreamshaper_8Inpainting.safetensors|https://civitai.com/api/download/models/131004?type=Model&format=SafeTensor|required
lora|models/Lora/animeoutlineV4_16.safetensors|https://civitai.com/api/download/models/28907?type=Model&format=SafeTensor|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_canny.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_canny.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_canny.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_canny.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11f1p_sd15_depth.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1p_sd15_depth.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11f1p_sd15_depth.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1p_sd15_depth.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_openpose.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_openpose.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11f1e_sd15_tile.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1e_sd15_tile.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11f1e_sd15_tile.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1e_sd15_tile.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_inpaint.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_inpaint.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_inpaint.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_inpaint.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_scribble.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_scribble.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_scribble.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_scribble.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_lineart.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_lineart.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15_lineart.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_lineart.yaml|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15s2_lineart_anime.pth|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15s2_lineart_anime.pth|required
controlnet|extensions/sd-webui-controlnet/models/control_v11p_sd15s2_lineart_anime.yaml|https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15s2_lineart_anime.yaml|required
controlnet|extensions/sd-webui-controlnet/models/xinsir_controlnet_union_sdxl_1.0.safetensors|https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors|required
sam|models/sam/sam_vit_b_01ec64.pth|https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth|required
sam|models/sam/sam_vit_h_4b8939.pth|https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth|required
adetailer|models/adetailer/face_yolov8s.pt|https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8s.pt|required
adetailer|models/adetailer/hand_yolov8s.pt|https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov8s.pt|required
upscaler|models/RealESRGAN/RealESRGAN_x4plus.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth|required
upscaler|models/RealESRGAN/RealESRGAN_x4plus_anime_6B.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth|required
upscaler|models/ESRGAN/4x-UltraSharp.pth|https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth|required
face-restore|models/Codeformer/codeformer-v0.1.0.pth|https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth|required
face-restore|models/GFPGAN/GFPGANv1.4.pth|https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth|required
checkpoint|models/Stable-diffusion/dreamshaper_8.safetensors|https://civitai.com/api/download/models/128713?type=Model&format=SafeTensor|optional
sam|models/sam/sam_vit_l_0b3195.pth|https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth|optional
MANIFEST
}

run_manifest "$include_optional"

if [[ "$check_only" -eq 1 ]]; then
  echo "Check complete."
elif [[ "$dry_run" -eq 1 ]]; then
  echo "Dry run complete."
else
  echo "Model download complete. Restart A1111 or refresh checkpoints/ControlNet models in the UI."
fi
