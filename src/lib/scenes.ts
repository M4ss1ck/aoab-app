import { getCollection } from 'astro:content';
import { getImage } from 'astro:assets';
import manifest from '../data/gallery.generated.json';
import { HERO_ID, orderImages, type SceneOverride } from './ordering';

export { HERO_ID, orderImages } from './ordering';
export type { Credit, TransitionKind, SceneOverride } from './ordering';

/**
 * Merges the asset pipeline's output with the optional metadata collection and
 * resolves every URL the runtime needs.
 *
 * This is the single place that knows how an image becomes a scene. The WebGL
 * renderer, the no-WebGL fallback and the intro all read from what this returns,
 * which is what keeps the three render paths from drifting apart.
 */

/**
 * Texture tiers in CSS pixels. The client picks one from viewport x DPR and
 * clamps it to the GPU's MAX_TEXTURE_SIZE, so a phone never downloads the 3200px
 * version and a 5K display is not served a blurry one.
 */
export const TEXTURE_TIERS = [1024, 1600, 2400, 3200] as const;

export interface ManifestImage {
  id: string;
  source: string;
  upscaled: string;
  depth: string;
  edges: string | null;
  width: number;
  height: number;
  aspect: number;
  palette: string[];
  focus: { x: number; y: number };
  lqip: string;
}

export interface Scene {
  id: string;
  index: number;
  title: string;
  credit: Credit | null;
  aspect: number;
  palette: string[];
  focus: { x: number; y: number };
  lqip: string;
  transition: TransitionKind;
  /** Texture URLs keyed by tier width, chosen at runtime. */
  tiers: Record<number, string>;
  depthUrl: string;
  /** Intrinsic size of the largest available texture, for the fallback img. */
  width: number;
  height: number;
}

const generated = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/generated/*.webp',
  { eager: true },
);

function asset(filename: string): ImageMetadata {
  const entry = generated[`/src/assets/generated/${filename}`];
  if (!entry) {
    throw new Error(
      `missing generated asset "${filename}". Run \`pnpm assets\` to rebuild derived assets.`,
    );
  }
  return entry.default;
}

export function manifestImage(id: string): ManifestImage {
  const found = (manifest.images as ManifestImage[]).find((image) => image.id === id);
  if (!found) {
    throw new Error(`"${id}" is not in the asset manifest. Run \`pnpm assets\`.`);
  }
  return found;
}

/**
 * Builds one tier per entry in TEXTURE_TIERS, skipping any tier that would
 * upscale past what the source actually has - serving a 3200px texture built
 * from a 2600px image is pure waste.
 */
async function buildTiers(image: ManifestImage): Promise<Record<number, string>> {
  const src = asset(image.upscaled);
  const usable = TEXTURE_TIERS.filter((tier, index) => {
    if (tier <= image.width) return true;
    // Always keep the first tier above the source width so the largest display
    // still gets the sharpest texture that exists, then stop.
    return TEXTURE_TIERS[index - 1] === undefined || TEXTURE_TIERS[index - 1] < image.width;
  });

  const entries = await Promise.all(
    usable.map(async (tier) => {
      const optimised = await getImage({
        src,
        width: Math.min(tier, image.width),
        format: 'webp',
        quality: 82,
      });
      return [tier, optimised.src] as const;
    }),
  );

  return Object.fromEntries(entries);
}

/**
 * Widths for the intro hero.
 *
 * The hero is on the critical path - it is what the intro is waiting for and
 * what the browser measures as the largest paint - so a phone must not be sent
 * the desktop version. Smaller steps than the gallery tiers, because this one
 * image decides how quickly the page becomes interesting.
 */
export const HERO_WIDTHS = [720, 1100, 1600, 2200] as const;

export async function getHero() {
  const image = manifestImage(HERO_ID);
  const source = asset(image.upscaled);

  const widths = HERO_WIDTHS.filter(
    (width, index) => width <= image.width || HERO_WIDTHS[index - 1] < image.width,
  );

  const [art, edges] = await Promise.all([
    Promise.all(
      widths.map(async (width) => {
        const optimised = await getImage({
          src: source,
          width: Math.min(width, image.width),
          format: 'webp',
          quality: 86,
        });
        return [width, optimised.src] as const;
      }),
    ),
    image.edges
      ? // The edge map is line art on flat paper: it survives a smaller size
        // far better than the painting does, and it is only ever shown once.
        getImage({ src: asset(image.edges), width: 1100, format: 'webp', quality: 84 })
      : Promise.resolve(null),
  ]);

  const artTiers = Object.fromEntries(art);

  return {
    id: image.id,
    artTiers,
    widths: [...widths],
    // Used for the preload hint and as the last-resort URL.
    artUrl: artTiers[widths[widths.length - 1]],
    srcset: art.map(([width, url]) => `${url} ${width}w`).join(', '),
    edgeUrl: edges?.src ?? null,
    lqip: image.lqip,
    palette: image.palette,
    aspect: image.aspect,
    width: image.width,
    height: image.height,
  };
}

export async function getScenes(): Promise<Scene[]> {
  const meta = await getCollection('gallery');
  const overrides = new Map<string, SceneOverride>(
    meta.map((entry) => [entry.id, entry.data as SceneOverride]),
  );

  const ordered = orderImages(manifest.images as ManifestImage[], overrides);

  return Promise.all(
    ordered.map(async (image, index) => {
      const override = overrides.get(image.id);
      const depth = await getImage({
        src: asset(image.depth),
        width: 512,
        format: 'webp',
        quality: 82,
      });

      return {
        id: image.id,
        index,
        title: override?.title ?? image.id,
        credit: override?.credit ?? null,
        aspect: image.aspect,
        palette: image.palette,
        focus: override?.focus ?? image.focus,
        lqip: image.lqip,
        transition: override?.transition ?? 'parametric',
        tiers: await buildTiers(image),
        depthUrl: depth.src,
        width: image.width,
        height: image.height,
      } satisfies Scene;
    }),
  );
}
