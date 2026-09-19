# Ascendance of a Bookworm

A WebGL art experience built around ten pieces of fan artwork. Each image fills
the viewport as a depth-displaced plane that responds to the cursor, scene
changes are shader set-pieces, and the whole thing opens with the hero artwork
being drawn on in pencil before it fills with colour.

Astro + vanilla TypeScript, GSAP for choreography, OGL for rendering. Static
output, served by Apache in the Docker image.

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static site into dist/
pnpm test         # unit tests (fast, deterministic)
pnpm test:e2e     # browser tests: the three render paths, a11y, orientation
```

`pnpm build` needs no Python and no model weights. Everything expensive is
precomputed and committed.

## Adding artwork

Drop the file into `src/assets/source/` and run:

```sh
pnpm assets
```

That is the whole contract. The pipeline upscales it, derives a depth map,
extracts a palette and a focal point, generates an inline placeholder, and
writes `src/data/gallery.generated.json`. The new image appears in the gallery,
in the fallback gallery, and in the closing wall, with a transition seeded from
its own filename and chrome colours taken from its own palette.

The first run downloads ~18MB of model weights and takes a few minutes per
image. Every run after that is a no-op on unchanged files — the pipeline is
keyed by content hash, so re-running costs about four seconds.

Removing an image is just as simple: delete it from `src/assets/source/` and run
`pnpm assets` again. Its derived files and manifest entry go with it.

### Overrides

Everything is derived automatically, so an image with no metadata still works.
`src/data/gallery.meta.json` is where you overrule the automatic choices:

```json
{
  "11": {
    "title": "Nightfall",
    "order": 95,
    "credit": {
      "artist": "Artist Name",
      "url": "https://example.com/the-original",
      "license": "CC BY 4.0"
    },
    "transition": "starfield",
    "focus": { "x": 0.5, "y": 0.4 },
    "hidden": false
  }
}
```

| Field        | Default                        | Notes                                                           |
| ------------ | ------------------------------ | --------------------------------------------------------------- |
| `title`      | the image id                   | Shown as the scene title and in the credits.                     |
| `order`      | after everything ordered, by id | Lower sorts earlier. Sets the colour/energy arc.                 |
| `credit`     | none                           | **Add this for any new artwork whose artist is known.**          |
| `transition` | `parametric`                   | `parametric`, `water` or `starfield`.                            |
| `focus`      | derived from the depth map     | Image space, `y` down. What the crop holds on to.                |
| `hidden`     | `false`                        | Keeps the entry but takes it out of the experience.              |

The schema is enforced at build time (`src/content.config.ts`), so a typo fails
the build rather than silently doing nothing. Keys starting with `_` are notes.

### Credits

The current ten pieces are Creative Commons works whose original artists could
not be traced, so the closing panel says exactly that. Anything added from here
should carry a `credit` block. It is rendered beside the artwork, in the closing
credits, and in the fallback gallery.

## How it fits together

```
src/assets/source/         originals, committed
  ↓  pnpm assets  (Python: Real-ESRGAN + Depth-Anything V2)
src/assets/generated/      upscales, depth maps, edge map, committed
src/data/gallery.generated.json
  ↓  astro build  (sharp, via astro:assets)
dist/                      responsive AVIF/WebP ladders + texture tiers
```

| Path                     | What it is                                                           |
| ------------------------ | -------------------------------------------------------------------- |
| `scripts/assets/`        | The asset pipeline. Two cache generations: heavy (upscale, depth) and light (palette, focus, placeholder), so retuning a palette does not re-run a four-minute upscale. |
| `src/lib/ordering.ts`    | Which images become scenes, and in what order. Pure, and tested directly. |
| `src/lib/scenes.ts`      | Merges the manifest with metadata and resolves every URL the runtime needs. The single source all three render paths read from. |
| `src/lib/gl/`            | Renderer, texture management, shaders.                                |
| `src/lib/intro.ts`       | The draw-on opening sequence.                                         |
| `src/lib/navigation.ts`  | Wheel, keyboard and touch, resolved into one intent.                  |
| `src/lib/chrome.ts`      | Titles, credits, scene rail, per-scene colour.                        |
| `src/lib/finale.ts`      | The closing composition.                                              |
| `src/components/FallbackGallery.astro` | The no-WebGL, no-JavaScript gallery.                    |

### Three render paths, one source of truth

The canvas experience is an enhancement. The server-rendered gallery is in the
document already, and WebGL replaces it only once it has successfully started —
so a missing context, a blocklisted GPU or disabled JavaScript all leave a real,
complete, accessible gallery behind rather than a blank canvas.

Reduced motion gets the full experience with the motion removed: every image,
the same chrome, cross-fades instead of set-pieces, and no parallax. It is not a
lesser site.

All three read from `getScenes()`, which is what stops them drifting apart.

## Things worth knowing before changing this

- **Texture orientation.** `UNPACK_FLIP_Y_WEBGL` is honoured for an
  `HTMLImageElement` and ignored for an `ImageBitmap`. `src/lib/gl/decode.ts`
  pre-flips the bitmap to compensate. Get this wrong and every image renders
  upside down while the entire test suite still passes — there is a test
  (`draws the artwork the right way up`) that compares the rendered frame with
  the source image specifically to catch it.
- **The shader's y axis points up.** Screen-space rectangles and focal points
  both need converting; see `focusToShaderSpace()` and the intro's art box.
- **Rendering is on demand.** A full-screen fragment shader redrawn forever is
  the most expensive thing on the page and almost every frame is identical.
  Anything that changes what is on screen must extend the render deadline with
  `keepRendering()`, or it will not be drawn.
- **Type never takes a palette colour.** The palette drives backdrop, glow and
  rules; text takes `--ink`, which flips between two values by measured
  luminance. The scrims are what guarantee contrast over artwork that ranges
  from near-black to near-white.
- **Planning documents belong in `docs/plans/` and are not committed.**

## Performance

Measured with Lighthouse against the production build.

| | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Desktop | 94 | 100 | 100 | 100 |
| Mobile | 78 (median of 3) | 100 | 100 | 100 |

LCP 0.7s desktop / 3.5s mobile. CLS 0 on both. Total blocking time 20ms desktop,
~440ms mobile. ~570KB transferred on mobile, 53KB of it gzipped JavaScript
(GSAP + OGL + the app) and 37KB the display face.

Mobile performance is short of the 90 target, and honestly so: it is 78, not 90.
Two things account for the gap.

The larger one is rasterising a full-screen fragment shader, which Lighthouse's
mobile profile does in software on a 4x-throttled CPU; a real phone GPU does it
in a fraction of the time. Rendering is already on demand, the idle path skips
the transition maths entirely, and textures decode off the main thread — TBT
came down from 5.3s to 0.44s on the way here. Getting past roughly 80 means
cutting the visual work itself.

The smaller one is the self-hosted display face, worth about 3 points: it is the
LCP element, and `font-display: swap` repaints it. That was a deliberate trade —
a wordmark that renders as Palatino on one machine and Georgia on another is a
worse outcome for this particular site than three Lighthouse points.
