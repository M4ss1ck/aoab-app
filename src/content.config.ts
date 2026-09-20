import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

/**
 * Optional per-image metadata.
 *
 * Everything the site needs is derived automatically by the asset pipeline, so
 * an image with no entry here still works. This collection exists for the parts
 * a machine cannot infer: what a piece is called, who made it, and any place we
 * want to overrule the automatic choices.
 */
const gallery = defineCollection({
  loader: file('src/data/gallery.meta.json', {
    parser: (text) =>
      Object.entries(JSON.parse(text) as Record<string, object>)
        // Keys starting with an underscore are notes to whoever edits this file.
        .filter(([id]) => !id.startsWith('_'))
        .map(([id, value]) => ({ id, ...value })),
  }),
  schema: z
    .object({
      /** The image id. The loader keys entries by it and also keeps it in data. */
      id: z.string().optional(),
      /** Shown as the scene title. Falls back to the image id. */
      title: z.string().optional(),
      /**
       * Displayed with the artwork and in the end credits.
       *
       * `artist` is optional because knowing where a piece came from and
       * knowing who drew it are two different facts, and we often have the
       * first without the second. A credit with only a `url` still earns its
       * place: it shows the reader the trail, and it is the fastest way for
       * whoever recognises the work to tell us the name. The refine is what
       * stops an entry that asserts neither.
       */
      credit: z
        .object({
          artist: z.string().min(1).optional(),
          url: z.string().url().optional(),
          license: z.string().optional(),
        })
        .refine((credit) => credit.artist || credit.url, {
          message: 'a credit needs an artist, a url, or both',
        })
        .optional(),
      /** Overrides the automatic colour-arc position. Lower sorts earlier. */
      order: z.number().optional(),
      /** Pins a specific transition instead of the parametric default. */
      transition: z.enum(['parametric', 'water', 'starfield']).optional(),
      /** Overrides the depth-derived focal point, in 0-1 image space. */
      focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
      /** Keeps an image in the collection but out of the experience. */
      hidden: z.boolean().optional(),
    })
    .strict(),
});

export const collections = { gallery };
