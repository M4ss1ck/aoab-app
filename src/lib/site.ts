import { CONTACT_EMAIL as CONFIGURED_CONTACT_EMAIL } from 'astro:env/server';

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
 * Comes from the environment, not from here: the address changes with the
 * deployment, and whoever redeploys should not need a commit to change it.
 * Unset is a supported state - the disclaimer drops the takedown sentence
 * rather than printing a placeholder nobody reads.
 *
 * Read at build time, because the site is static output. Setting it after the
 * build has no effect.
 */
const configured = CONFIGURED_CONTACT_EMAIL?.trim() || null;

// A dead contact line is worse than an absent one, and the mistake is easy to
// make in a deploy panel where nothing checks what was typed. Failing the
// build is the only place this can be caught before an artist tries it.
if (configured && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured)) {
  throw new Error(
    `CONTACT_EMAIL is set to "${configured}", which is not an email address. ` +
      'Leave it unset to omit the takedown line entirely.',
  );
}

export const CONTACT_EMAIL: string | null = configured;
