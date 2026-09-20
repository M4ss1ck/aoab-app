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
  /** Absent when we know where a piece came from but not who drew it. */
  artist?: string;
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

/**
 * How the credits panel should talk about what has not been traced.
 *
 * Two rules, and the second is the interesting one. Every piece is always
 * listed, because filtering to the credited ones would let a half-traced
 * gallery read as fully attributed. But when *nothing* has been traced, a
 * per-item "Artist untraced" on all ten rows says the same thing ten times and
 * repeats the sentence in the note underneath it, so the label earns its place
 * only when it tells one row apart from another.
 *
 * Nothing is concealed either way: the note states the count in prose.
 */
export function creditSummary(scenes: Array<{ credit?: { artist?: string } | null }>): {
  untraced: number;
  total: number;
  labelPerItem: boolean;
} {
  // Untraced means "no artist", not "no credit". A piece with a source link
  // and no name is still a piece we cannot attribute, and saying otherwise
  // would be the same lie in a smaller font.
  const untraced = scenes.filter((scene) => !scene.credit?.artist).length;
  return {
    untraced,
    total: scenes.length,
    labelPerItem: untraced > 0 && untraced < scenes.length,
  };
}

/**
 * The one sentence that states what is still missing.
 *
 * Written out rather than assembled inline because both the finale and the
 * fallback have to say exactly the same thing, and because the obvious phrasing
 * is ambiguous: "8 of these pieces could be traced back to an artist" reads as
 * eight successes when it means eight failures. The negative is stated plainly
 * instead.
 *
 * @returns The sentence, or null when everything is credited and there is
 *   nothing to admit.
 */
export function untracedSentence(untraced: number, total: number): string | null {
  if (untraced <= 0) return null;
  if (untraced === total) return 'None of these pieces has been traced back to its artist yet.';
  if (untraced === 1) return 'One of these pieces has not been traced back to its artist yet.';
  return `${untraced} of these pieces have not been traced back to their artists yet.`;
}
