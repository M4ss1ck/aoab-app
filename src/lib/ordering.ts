/**
 * Gallery domain rules that do not depend on Astro.
 *
 * Kept separate from scenes.ts so the ordering contract - which decides what
 * happens when someone adds artwork - can be tested directly, without Astro's
 * virtual modules needing to resolve.
 */

/** The intro hero. Not a gallery scene. */
export const HERO_ID = 'myne';

export type TransitionKind = 'parametric' | 'water' | 'starfield';

export interface Credit {
  artist: string;
  url?: string;
  license?: string;
}

export interface SceneOverride {
  title?: string;
  credit?: Credit;
  order?: number;
  transition?: TransitionKind;
  focus?: { x: number; y: number };
  hidden?: boolean;
}

/**
 * Decides which images become scenes, and in what order.
 *
 * Pure, because this is the contract for adding artwork: drop a file in, run
 * the pipeline, and it appears. Everything it does is a rule somebody will
 * depend on later, so it is tested directly rather than through a build.
 */
export function orderImages<T extends { id: string }>(
  images: T[],
  overrides: Map<string, SceneOverride>,
): T[] {
  return images
    .filter((image) => image.id !== HERO_ID && overrides.get(image.id)?.hidden !== true)
    .slice()
    .sort((a, b) => {
      // Images with no explicit order sort after the curated arc, then by id,
      // so a newly added file lands predictably at the end rather than
      // wherever the filesystem happened to put it.
      const orderA = overrides.get(a.id)?.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = overrides.get(b.id)?.order ?? Number.MAX_SAFE_INTEGER;
      return orderA === orderB ? a.id.localeCompare(b.id) : orderA - orderB;
    });
}
