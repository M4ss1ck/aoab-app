import { Texture } from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { decodeImage } from './decode';

export interface TierChoiceInput {
  tiers: readonly number[];
  /** Longest viewport edge in CSS pixels. */
  viewport: number;
  dpr: number;
  /** The GPU's reported MAX_TEXTURE_SIZE. */
  maxTextureSize: number;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  deviceMemory?: number;
}

/**
 * Picks the smallest texture tier that still covers the display.
 *
 * Pure so it can be tested across the device matrix without a GPU. Three things
 * bound the choice, and the smallest wins:
 *
 *  - what the display can actually show (viewport x DPR)
 *  - what the GPU will accept (MAX_TEXTURE_SIZE), which on older mobile parts
 *    is 2048 or even 1024 and will fail the upload rather than scale for us
 *  - how much memory the device admits to, when it admits to any
 *
 * DPR is capped at 2 because the third pixel of a 3x phone display is not
 * visible on full-bleed artwork and costs more than twice the bytes.
 */
export function chooseTier({
  tiers,
  viewport,
  dpr,
  maxTextureSize,
  deviceMemory,
}: TierChoiceInput): number {
  const sorted = [...tiers].sort((a, b) => a - b);
  if (!sorted.length) throw new Error('no texture tiers available');

  const effectiveDpr = Math.min(Math.max(dpr, 1), 2);
  const wanted = viewport * effectiveDpr;

  // Device memory is a hint, absent on Safari and Firefox. When it is present
  // and low, refuse to reach for the top tiers regardless of the display.
  const memoryCap = deviceMemory !== undefined && deviceMemory <= 4 ? 1600 : Infinity;
  const ceiling = Math.min(maxTextureSize, memoryCap);

  // Never exceed the ceiling, even if that means a softer image: an oversized
  // texture is a failed upload, which is a black screen.
  const affordable = sorted.filter((tier) => tier <= ceiling);
  const usable = affordable.length ? affordable : [sorted[0]];

  return usable.find((tier) => tier >= wanted) ?? usable[usable.length - 1];
}

export interface SceneTextureSource {
  id: string;
  tiers: Record<number, string>;
  depthUrl: string;
  lqip: string;
}

export interface SceneTextures {
  colour: Texture;
  depth: Texture;
  /** False until the full-resolution texture has replaced the placeholder. */
  ready: boolean;
}

/**
 * Loads and caches the textures for every scene.
 *
 * Three rules, which together are what keep the first paint cheap no matter how
 * many images the gallery grows to:
 *
 *  - every scene is immediately usable, because its inline LQIP is uploaded
 *    synchronously and swapped for the real texture when that arrives
 *  - only the current scene and its immediate neighbours are ever fetched
 *  - the tier is chosen once from viewport, DPR and the GPU's own limit
 */
export class TextureManager {
  private readonly gl: OGLRenderingContext;
  private readonly sources = new Map<string, SceneTextureSource>();
  private readonly textures = new Map<string, SceneTextures>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly maxTextureSize: number;
  private tier: number;

  constructor(gl: OGLRenderingContext, availableTiers: readonly number[]) {
    this.gl = gl;
    this.maxTextureSize = gl.renderer.gl.getParameter(gl.renderer.gl.MAX_TEXTURE_SIZE);
    this.tier = this.pickTier(availableTiers);
  }

  private pickTier(availableTiers: readonly number[]): number {
    return chooseTier({
      tiers: availableTiers,
      viewport: Math.max(window.innerWidth, window.innerHeight),
      dpr: window.devicePixelRatio || 1,
      maxTextureSize: this.maxTextureSize,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
  }

  register(source: SceneTextureSource): void {
    this.sources.set(source.id, source);
  }

  /**
   * Returns textures for a scene straight away, uploading the LQIP on first
   * call so the renderer never has to deal with a missing texture, and kicking
   * off the real load in the background.
   */
  get(id: string): SceneTextures {
    const existing = this.textures.get(id);
    if (existing) {
      void this.load(id);
      return existing;
    }

    const source = this.sources.get(id);
    if (!source) throw new Error(`unknown scene texture "${id}"`);

    const placeholder: SceneTextures = {
      colour: new Texture(this.gl, { generateMipmaps: false }),
      depth: new Texture(this.gl, { generateMipmaps: false }),
      ready: false,
    };

    // A single mid-grey pixel for depth: flat until the real map lands, so the
    // parallax starts at zero rather than at something wrong.
    placeholder.depth.image = new Uint8Array([128, 128, 128, 255]);
    placeholder.depth.width = 1;
    placeholder.depth.height = 1;

    this.textures.set(id, placeholder);

    const lqip = new Image();
    lqip.src = source.lqip;
    lqip.decode().then(
      () => {
        if (!placeholder.ready) placeholder.colour.image = lqip;
      },
      () => {
        /* the real texture is on its way regardless */
      },
    );

    void this.load(id);
    return placeholder;
  }

  /** Fetches the full-resolution colour and depth textures, once. */
  private load(id: string): Promise<void> {
    const started = this.inFlight.get(id);
    if (started) return started;

    const source = this.sources.get(id);
    const target = this.textures.get(id);
    if (!source || !target) return Promise.resolve();

    const url = source.tiers[this.tier] ?? Object.values(source.tiers).pop();
    if (!url) return Promise.resolve();

    const promise = Promise.all([decodeImage(url), decodeImage(source.depthUrl)]).then(
      ([colour, depth]) => {
        target.colour.image = colour;
        target.depth.image = depth;
        target.ready = true;
      },
      () => {
        // Leave the placeholder in place. A scene rendered from its LQIP is
        // soft but correct; a scene with no texture is a black hole.
      },
    );

    this.inFlight.set(id, promise);
    return promise;
  }

  /** Warms neighbours during idle time so a scene change never stalls. */
  prefetch(ids: string[]): void {
    const run = () => ids.forEach((id) => this.get(id));
    if ('requestIdleCallback' in window) {
      (window as Window & typeof globalThis).requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 200);
    }
  }

  /** Resolves once the given scenes are at full resolution. */
  whenReady(ids: string[]): Promise<void> {
    return Promise.all(ids.map((id) => (this.get(id), this.load(id)))).then(() => undefined);
  }

  get selectedTier(): number {
    return this.tier;
  }
}

