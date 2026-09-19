"""Build-time asset pipeline.

Turns every image in src/assets/source into the derived assets the site needs:

  <id>.webp        4x anime-tuned upscale, the new canonical source for astro:assets
  <id>.depth.webp  512px grayscale depth map, drives the 2.5D parallax
  <id>.edge.webp   edge map, only for images flagged as needing one (the intro hero)

plus a manifest entry carrying palette, focal point, aspect and an inline LQIP.

Everything is keyed by a content hash of the source file and the pipeline version,
so re-running is a no-op on unchanged files. Adding an image means dropping it in
src/assets/source and running this once.

This never runs during `astro build` - its outputs are committed.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

# Two cache generations, because the two halves of this pipeline cost wildly
# different amounts. HEAVY covers the upscale and depth passes (minutes); LIGHT
# covers palette, focus and LQIP (milliseconds). Tuning the palette should not
# cost a full re-upscale, so bump LIGHT_VERSION for that and leave HEAVY alone.
HEAVY_VERSION = 1
LIGHT_VERSION = 2
PIPELINE_VERSION = HEAVY_VERSION

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "src" / "assets" / "source"
OUT_DIR = ROOT / "src" / "assets" / "generated"
MANIFEST = ROOT / "src" / "data" / "gallery.generated.json"
CACHE_FILE = ROOT / ".cache" / "assets-cache.json"
MODEL_DIR = ROOT / ".cache" / "models"

UPSCALER_PATH = MODEL_DIR / "RealESRGAN_x4plus_anime_6B.pth"
UPSCALER_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/"
    "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
)
DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"

SUPPORTED = {".png", ".jpg", ".jpeg", ".webp"}

# The intro hero needs an edge map; nothing else does.
EDGE_MAP_IDS = {"myne"}

DEPTH_SIZE = 512       # depth maps are smooth gradients, more is wasted bytes
UPSCALE_QUALITY = 92   # visually lossless on flat-shaded art, a fraction of the bytes
MAX_UPSCALED_EDGE = 3200
LQIP_WIDTH = 24
TILE = 256             # upscale tile size, keeps CPU memory bounded
TILE_PAD = 16


# --------------------------------------------------------------------------
# cache
# --------------------------------------------------------------------------


def content_key(path: Path, generation: int) -> str:
    h = hashlib.sha256()
    h.update(f"v{generation}:".encode())
    h.update(path.read_bytes())
    return h.hexdigest()


def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def save_cache(cache: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, indent=2, sort_keys=True))


# --------------------------------------------------------------------------
# upscale
# --------------------------------------------------------------------------


def ensure_upscaler():
    from spandrel import ModelLoader

    if not UPSCALER_PATH.exists():
        raise SystemExit(
            f"missing upscaler weights at {UPSCALER_PATH}\n"
            f"download it with:\n  curl -L -o {UPSCALER_PATH} {UPSCALER_URL}"
        )
    descriptor = ModelLoader().load_from_file(str(UPSCALER_PATH))
    descriptor.model.eval()
    return descriptor


@torch.no_grad()
def upscale(descriptor, img: Image.Image) -> Image.Image:
    """Tiled 4x upscale. Tiling keeps peak memory flat regardless of input size."""
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
    _, _, h, w = tensor.shape
    scale = descriptor.scale
    out = torch.zeros((1, 3, h * scale, w * scale), dtype=torch.float32)

    for y in range(0, h, TILE):
        for x in range(0, w, TILE):
            # Pad each tile so the model sees context across the seam, then crop
            # the padding back off - otherwise tile borders show as hard lines.
            y0, y1 = max(0, y - TILE_PAD), min(h, y + TILE + TILE_PAD)
            x0, x1 = max(0, x - TILE_PAD), min(w, x + TILE + TILE_PAD)
            tile_out = descriptor.model(tensor[:, :, y0:y1, x0:x1])

            top = (y - y0) * scale
            left = (x - x0) * scale
            th = (min(h, y + TILE) - y) * scale
            tw = (min(w, x + TILE) - x) * scale
            out[:, :, y * scale : y * scale + th, x * scale : x * scale + tw] = (
                tile_out[:, :, top : top + th, left : left + tw]
            )

    result = out.clamp(0, 1).squeeze(0).permute(1, 2, 0).numpy()
    up = Image.fromarray((result * 255.0 + 0.5).astype(np.uint8), mode="RGB")

    if max(up.size) > MAX_UPSCALED_EDGE:
        ratio = MAX_UPSCALED_EDGE / max(up.size)
        up = up.resize(
            (round(up.width * ratio), round(up.height * ratio)), Image.LANCZOS
        )
    return up


def upscale_rgba(descriptor, img: Image.Image) -> Image.Image:
    """The hero is a cutout. Upscale colour and alpha separately so the model
    never sees the transparent background as black and bleeds it into the edges."""
    rgb = upscale(descriptor, img.convert("RGB"))
    alpha = img.getchannel("A").resize(rgb.size, Image.LANCZOS)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


# --------------------------------------------------------------------------
# depth
# --------------------------------------------------------------------------


def build_depth(depth_pipe, img: Image.Image) -> Image.Image:
    depth = depth_pipe(img.convert("RGB"))["depth"]
    arr = np.asarray(depth, dtype=np.float32)

    lo, hi = float(arr.min()), float(arr.max())
    arr = (arr - lo) / (hi - lo) if hi > lo else np.zeros_like(arr)

    # A light blur stops single-pixel depth jumps from tearing the displaced mesh.
    arr = cv2.GaussianBlur(arr, (0, 0), sigmaX=1.6)

    out = Image.fromarray((arr * 255.0 + 0.5).astype(np.uint8), mode="L")
    ratio = DEPTH_SIZE / max(out.size)
    if ratio < 1:
        out = out.resize(
            (max(1, round(out.width * ratio)), max(1, round(out.height * ratio))),
            Image.LANCZOS,
        )
    return out


def focal_point(depth: Image.Image) -> dict:
    """Centroid of the nearest 15% of pixels - a free saliency proxy that lands
    on the subject, which is what the crop should hold on to."""
    arr = np.asarray(depth, dtype=np.float32) / 255.0
    threshold = float(np.quantile(arr, 0.85))
    ys, xs = np.nonzero(arr >= threshold)
    if len(xs) == 0:
        return {"x": 0.5, "y": 0.5}
    return {
        "x": round(float(xs.mean()) / arr.shape[1], 4),
        "y": round(float(ys.mean()) / arr.shape[0], 4),
    }


# --------------------------------------------------------------------------
# edges
# --------------------------------------------------------------------------


def build_edges(img: Image.Image) -> Image.Image:
    """Edge map for the draw-on intro. Bilateral filter first so flat-shaded
    regions don't fire, leaving mostly the linework an artist would have drawn."""
    rgb = np.asarray(img.convert("RGB"))
    if img.mode == "RGBA":
        # Composite onto white, otherwise the cutout border reads as a hard edge.
        alpha = np.asarray(img.getchannel("A"), dtype=np.float32)[..., None] / 255.0
        rgb = (rgb * alpha + 255.0 * (1 - alpha)).astype(np.uint8)

    smooth = cv2.bilateralFilter(rgb, d=9, sigmaColor=75, sigmaSpace=75)
    gray = cv2.cvtColor(smooth, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 40, 110)
    edges = cv2.GaussianBlur(edges, (0, 0), sigmaX=0.8)

    if img.mode == "RGBA":
        alpha_mask = np.asarray(img.getchannel("A"), dtype=np.float32) / 255.0
        # Erode the alpha so the silhouette's own outline is kept but the
        # antialiased fringe outside it is not.
        eroded = cv2.erode(alpha_mask, np.ones((5, 5), np.uint8))
        edges = (edges * eroded).astype(np.uint8)

    return Image.fromarray(edges, mode="L")


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------


def kmeans(pixels: np.ndarray, k: int, seed: int = 7, iterations: int = 24):
    """Deterministic k-means. Fixed seed matters: the palette feeds the chrome
    and the transition parameters, so it has to be stable across builds."""
    rng = np.random.default_rng(seed)
    centres = pixels[rng.choice(len(pixels), size=k, replace=False)].astype(np.float32)

    for _ in range(iterations):
        distances = ((pixels[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        labels = distances.argmin(axis=1)
        moved = False
        for i in range(k):
            members = pixels[labels == i]
            if len(members) == 0:
                continue
            centre = members.mean(axis=0)
            if not np.allclose(centre, centres[i]):
                centres[i] = centre
                moved = True
        if not moved:
            break

    counts = np.bincount(labels, minlength=k)
    return centres, counts


def opaque_pixels(img: Image.Image, size: int = 72) -> np.ndarray:
    """Sample pixels for palette work, dropping transparent ones entirely.

    The hero is a cutout: converting it straight to RGB turns everything outside
    the silhouette into pure black, which then wins the palette on sheer area
    and produces a dead chrome colour.
    """
    small = img.resize((size, size), Image.LANCZOS)
    if small.mode == "RGBA":
        rgb = np.asarray(small.convert("RGB"), dtype=np.float32).reshape(-1, 3)
        alpha = np.asarray(small.getchannel("A"), dtype=np.float32).reshape(-1)
        kept = rgb[alpha > 200]
        if len(kept) >= 16:
            return kept
        return rgb
    return np.asarray(small.convert("RGB"), dtype=np.float32).reshape(-1, 3)


def extract_palette(img: Image.Image, count: int = 3) -> list[str]:
    """Three colours that actually characterise the image.

    Two failure modes this guards against, both seen in practice:
      - a low-chroma colour covering most of the frame wins on area alone and
        the chrome ends up grey (02's ash, 10's white stonework)
      - the top three end up being one hue at three lightnesses, which gives
        the chrome nothing to contrast against (03's golds)
    """
    pixels = opaque_pixels(img)
    centres, counts = kmeans(pixels, k=8)

    hsv = (
        cv2.cvtColor(centres.reshape(1, -1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV)
        .reshape(-1, 3)
        .astype(np.float32)
    )
    hue = hsv[:, 0] * 2.0  # OpenCV packs hue into 0-179
    saturation = hsv[:, 1] / 255.0
    value = hsv[:, 2] / 255.0
    share = counts / max(1, counts.sum())

    # Square-rooting the area share stops a dominant flat background from
    # burying a small but defining accent, while chroma is weighted super-
    # linearly so saturated colours genuinely outrank near-greys.
    score = np.sqrt(share) * (0.12 + saturation) ** 1.6 * (0.30 + value)

    def hue_distance(a: float, b: float) -> float:
        delta = abs(a - b) % 360.0
        return min(delta, 360.0 - delta)

    chosen: list[int] = []
    for index in np.argsort(-score):
        if len(chosen) >= count:
            break
        # Only enforce hue spacing between colours that both have enough chroma
        # for hue to be meaningful; on a genuinely monochrome image, fall back
        # to spacing by lightness so the three are still distinguishable.
        conflict = False
        for picked in chosen:
            if saturation[index] > 0.15 and saturation[picked] > 0.15:
                if hue_distance(hue[index], hue[picked]) < 25.0:
                    conflict = True
            elif abs(value[index] - value[picked]) < 0.18:
                conflict = True
        if not conflict:
            chosen.append(int(index))

    # Relax the spacing rule rather than return fewer than `count` colours.
    for index in np.argsort(-score):
        if len(chosen) >= count:
            break
        if int(index) not in chosen:
            chosen.append(int(index))

    return [
        "#%02x%02x%02x" % tuple(int(round(c)) for c in centres[i].clip(0, 255))
        for i in chosen
    ]


# --------------------------------------------------------------------------
# lqip
# --------------------------------------------------------------------------


def build_lqip(img: Image.Image) -> str:
    ratio = LQIP_WIDTH / img.width
    tiny = img.convert("RGB").resize(
        (LQIP_WIDTH, max(1, round(img.height * ratio))), Image.LANCZOS
    )
    buffer = io.BytesIO()
    tiny.save(buffer, format="WEBP", quality=60, method=6)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------


def discover() -> list[Path]:
    if not SOURCE_DIR.exists():
        raise SystemExit(f"no source directory at {SOURCE_DIR}")
    return sorted(
        p for p in SOURCE_DIR.iterdir() if p.suffix.lower() in SUPPORTED and p.is_file()
    )


def open_source(path: Path) -> Image.Image:
    img = Image.open(path)
    img.load()
    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    return img.convert("RGBA" if has_alpha else "RGB")


def run_heavy(path: Path, descriptor, depth_pipe) -> dict:
    """Upscale, depth and edges. Minutes per image, so cached aggressively."""
    img = open_source(path)
    identifier = path.stem
    has_alpha = img.mode == "RGBA"

    upscaled = upscale_rgba(descriptor, img) if has_alpha else upscale(descriptor, img)
    upscaled_path = OUT_DIR / f"{identifier}.webp"
    upscaled.save(upscaled_path, format="WEBP", quality=UPSCALE_QUALITY, method=6)

    depth = build_depth(depth_pipe, img)
    depth_path = OUT_DIR / f"{identifier}.depth.webp"
    depth.save(depth_path, format="WEBP", quality=88, method=6)

    edges_name = None
    if identifier in EDGE_MAP_IDS:
        edges = build_edges(img)
        edges_name = f"{identifier}.edge.webp"
        edges.save(OUT_DIR / edges_name, format="WEBP", quality=88, method=6)

    return {
        "upscaled": upscaled_path.name,
        "depth": depth_path.name,
        "edges": edges_name,
        "width": upscaled.width,
        "height": upscaled.height,
        "aspect": round(upscaled.width / upscaled.height, 5),
    }


def run_light(path: Path) -> dict:
    """Palette, focal point and LQIP. Cheap, so these can be retuned freely."""
    img = open_source(path)
    depth_path = OUT_DIR / f"{path.stem}.depth.webp"
    depth = Image.open(depth_path).convert("L")
    return {
        "palette": extract_palette(img),
        "focus": focal_point(depth),
        "lqip": build_lqip(img),
    }


def main() -> int:
    force = "--force" in sys.argv
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    sources = discover()
    if not sources:
        print("no source images found")
        return 1

    cache = {} if force else load_cache()
    entries: dict[str, dict] = cache.get("entries", {}) if not force else {}
    known = {p.stem for p in sources}

    # Drop entries whose source file is gone, so deleting an image is as simple
    # as deleting the file.
    for orphan in set(entries) - known:
        del entries[orphan]
        for leftover in OUT_DIR.glob(f"{orphan}.*"):
            leftover.unlink()
        print(f"  removed {orphan} (source deleted)")

    def outputs_present(identifier: str) -> bool:
        return (OUT_DIR / f"{identifier}.webp").exists() and (
            OUT_DIR / f"{identifier}.depth.webp"
        ).exists()

    heavy_stale = [
        p
        for p in sources
        if entries.get(p.stem, {}).get("heavyKey") != content_key(p, HEAVY_VERSION)
        or not outputs_present(p.stem)
    ]

    if heavy_stale:
        print(f"upscale + depth: {len(heavy_stale)} of {len(sources)} images")
        from transformers import pipeline as hf_pipeline

        descriptor = ensure_upscaler()
        depth_pipe = hf_pipeline("depth-estimation", model=DEPTH_MODEL, device="cpu")

        for index, path in enumerate(heavy_stale, start=1):
            started = time.time()
            heavy = run_heavy(path, descriptor, depth_pipe)
            entry = entries.setdefault(path.stem, {})
            entry.update(heavy)
            entry["id"] = path.stem
            entry["source"] = path.name
            entry["heavyKey"] = content_key(path, HEAVY_VERSION)
            entry.pop("lightKey", None)  # new pixels mean the light pass is stale too
            print(
                f"  [{index}/{len(heavy_stale)}] {path.name} -> "
                f"{heavy['width']}x{heavy['height']} ({time.time() - started:.1f}s)"
            )
    else:
        print(f"upscale + depth: up to date ({len(sources)} images)")

    light_stale = [
        p
        for p in sources
        if entries.get(p.stem, {}).get("lightKey") != content_key(p, LIGHT_VERSION)
    ]

    if light_stale:
        print(f"palette + focus + lqip: {len(light_stale)} of {len(sources)} images")
        for path in light_stale:
            entry = entries[path.stem]
            entry.update(run_light(path))
            entry["lightKey"] = content_key(path, LIGHT_VERSION)
            print(f"  {path.name} palette {' '.join(entry['palette'])}")
    else:
        print(f"palette + focus + lqip: up to date ({len(sources)} images)")

    internal = {"heavyKey", "lightKey"}
    ordered = [entries[p.stem] for p in sources]
    payload = {
        "heavyVersion": HEAVY_VERSION,
        "lightVersion": LIGHT_VERSION,
        "generated": len(ordered),
        "images": [
            {k: v for k, v in e.items() if k not in internal} for e in ordered
        ],
    }
    MANIFEST.write_text(json.dumps(payload, indent=2) + "\n")
    save_cache({"heavyVersion": HEAVY_VERSION, "lightVersion": LIGHT_VERSION, "entries": entries})

    print(f"manifest written to {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
