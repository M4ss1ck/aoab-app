#!/usr/bin/env bash
# One command to regenerate derived assets. Creates the venv, installs deps and
# fetches model weights on first run; after that it is just the pipeline, which
# is a no-op on unchanged images.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$ROOT/.venv-assets"
MODELS="$ROOT/.cache/models"
UPSCALER="$MODELS/RealESRGAN_x4plus_anime_6B.pth"
UPSCALER_URL="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"

if [ ! -x "$VENV/bin/python" ]; then
  echo "creating asset pipeline venv"
  python3 -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c "import spandrel, transformers, cv2; from PIL import features; assert features.check('avif')" 2>/dev/null; then
  echo "installing pipeline dependencies (one time, a few minutes)"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$ROOT/scripts/assets/requirements.txt"
fi

if [ ! -f "$UPSCALER" ]; then
  echo "downloading upscaler weights (18MB, one time)"
  mkdir -p "$MODELS"
  curl -fL --progress-bar -o "$UPSCALER" "$UPSCALER_URL"
fi

exec "$VENV/bin/python" -u "$ROOT/scripts/assets/pipeline.py" "$@"
