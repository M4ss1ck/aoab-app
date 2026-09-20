/**
 * Facts about the site itself, as opposed to the artwork in it.
 *
 * Small and separate because the credits, the disclaimer and the fallback
 * gallery all need the same answers, and a public gallery of other people's
 * work should state them in exactly one place.
 */

/**
 * The work these pieces are drawn from, and who owns it.
 *
 * Every image in `src/assets/source/` is fan art of Ascendance of a Bookworm
 * (Honzuki no Gekokujou). That makes each one a derivative of a licensed work,
 * and the site says so rather than implying the art is unencumbered.
 */
export const SOURCE_WORK = {
  title: 'Ascendance of a Bookworm',
  author: 'Miya Kazuki',
  illustrator: 'You Shiina',
  publisher: 'TO Books',
} as const;

/**
 * Where an artist can reach a human.
 *
 * Deliberately `null` until a real address exists. A takedown line pointing at
 * a placeholder is worse than no line at all, so the disclaimer drops the
 * sentence rather than printing something nobody reads.
 */
export const CONTACT_EMAIL: string | null = null;
