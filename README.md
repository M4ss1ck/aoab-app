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

Every piece here is fan artwork for Ascendance of a Bookworm. That makes each
one a derivative of a licensed work - the series is Miya Kazuki's, illustrated
by You Shiina, published by TO Books - and it belongs to whoever drew it. The
closing panel says so, names the rights holders, and disclaims any affiliation.

The files arrived stripped of provenance: no EXIF author, no original filename.
All eleven were re-saved through a phone gallery app in one five-minute session
(`exif:DateTime` reads `2025:03:22` on every one), which is what removed it.
Only `04.jpeg` still names a tool, `Celsys Studio Tool`. So the artists have to
be traced by reverse image search.

All eleven now carry a credit. Nine name an artist; two (`03`, `05`) name only
where the piece was found, because the wallpaper sites hosting them do not say
who drew them. `credit.artist` is optional for exactly that reason - knowing the
source and knowing the artist are two different facts, and a credit with only a
`url` still shows the trail and invites a correction. A credit that asserts
neither fails the schema.

A piece with no artist is labelled *Artist untraced* beside a **Source** link,
and both the closing credits and the fallback gallery carry a note naming the
rights holders and saying in prose how many pieces are still unattributed. The
rule lives in `creditSummary` and `untracedSentence` (`src/lib/ordering.ts`) so
all three render paths make the same statement.

To trace a new piece, two tools, in order of effort.

`scripts/provenance/trace.py` does it without a browser. The artwork here is
mostly crops, and a crop defeats the global perceptual hashes IQDB and SauceNAO
match on - but the corpus is one Danbooru tag with under a thousand posts, and
that API is open. So it pulls the haystack down once and matches locally, where
a crop is easy:

```sh
python3 scripts/provenance/trace.py fetch     # post metadata
python3 scripts/provenance/trace.py download  # candidate images, resumable
python3 scripts/provenance/trace.py match     # ORB + RANSAC, local
```

`TRACE_MIN_INLIERS` defaults to 80 and that number is measured, not chosen: on
this corpus real matches scored 782-2410 inliers and false positives 12-25. It
found five of the eleven. **Confirm every hit by eye before writing it down** -
at a threshold of 12 the matcher confidently named four wrong artists.

`scripts/provenance/build-sheet.mjs` covers what the matcher cannot, which is
anything outside the Danbooru corpus. It builds a page with each source image
beside pre-aimed Google Lens, SauceNAO, ascii2d and TinEye links, and one button
that emits the whole `gallery.meta.json` with your answers merged in, in the
file's own key order and formatting - so a pass that traced nothing leaves a
zero-line diff:

```sh
node scripts/provenance/build-sheet.mjs /tmp/provenance.html
```

### Contact address

Before the site goes public, set `CONTACT_EMAIL` so an artist has somewhere to
write. It lives in the environment rather than in the source, because the
address belongs to the deployment and changing it should not need a commit.

```sh
cp .env.example .env    # then fill it in
```

The site is static output, so this is read when the site is **built**, not when
it is served:

| Where | How |
| ----- | --- |
| local | `.env`, or `CONTACT_EMAIL=you@example.org pnpm build` |
| docker | `docker build --build-arg CONTACT_EMAIL=you@example.org .` |
| Coolify | **Build** Variables, not Environment Variables |

Setting it as a runtime variable does nothing: by then the HTML already exists.

Unset is a supported state - the takedown sentence is omitted, because a contact
line pointing at a placeholder is worse than none. A value that is not an email
address fails the build rather than shipping a `mailto:` nobody can use.

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
- **Parallax is deliberately tiny** (`PARALLAX_STRENGTH`, 0.012). Offsetting
  texture coordinates by depth is a fake: nothing exists behind the subject, so
  any pixel the foreground moves has to be invented by smearing its neighbours.
  Past roughly 0.015 that smear shows up as tearing around hair and hands. The
  depth map is also blurred with a five-tap kernel in the shader, because a hard
  depth edge pulls neighbouring pixels in opposite directions and splits the
  image along every silhouette.
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

## Deploying

Coolify builds `Dockerfile` on the host and swaps the container. Two BuildKit
cache mounts do the heavy lifting:

- `/pnpm-store` keeps the package tarballs, so a lockfile change installs from
  local disk instead of the network.
- `/app/node_modules/.astro/assets` keeps Astro's optimised images. Astro keys
  that cache by source content hash, so an image that has not changed is copied,
  not re-encoded.

The second one is the whole deploy budget. There are ten source images and 255
derived variants (five widths, avif + webp + a jpeg fallback, plus the hero
tiers and the depth maps). Encoding them all costs 75s of wall clock and 2.4GB
of peak RSS on sixteen cores; Astro fans the queue out to `os.cpus().length`
(`core/build/generate.js`), which inside a container is the *host's* core count,
so a small VPS starts swapping and the same work takes tens of minutes.

Measured end to end, `docker build` on this repo:

| Build | Wall | Image step |
| --- | --- | --- |
| First build on a fresh host | 159s | 75.3s |
| Deploy with source changes | **6.3s** | **11ms** |
| Coolify "Force rebuild" (`--no-cache`) | 97s | 74.7s |

A force rebuild pays the encode cost again but does not poison the cache: the
next ordinary deploy is back to seconds. Only prune the builder cache when you
mean to.

Adding artwork is the one change that legitimately re-encodes, and only for the
files whose content hash moved.

### Zero downtime

The image declares a `HEALTHCHECK` that makes a real HTTP request to Apache on
port 80. Coolify waits for it before cutting traffic over, so the running
container keeps serving for the whole build. If a deploy still drops requests,
the rolling-update setting on the Coolify resource is off.

### Dependencies

The build runs `pnpm install --frozen-lockfile`. It used to run `npm i`, which
ignored `pnpm-lock.yaml` and re-resolved every floating range at deploy time, so
production quietly ran different code than the tests did.
