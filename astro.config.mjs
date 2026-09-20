// @ts-check
import { defineConfig, envField } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served as static files by Apache in the Docker image; nothing needs a server.
  output: 'static',
  env: {
    schema: {
      /**
       * Where an artist can reach a human about their work.
       *
       * Optional, so the site builds without it and simply omits the takedown
       * sentence - a contact line pointing at a placeholder is worse than none.
       * `access: 'public'` because a mailto: in the closing credits is public
       * by definition; the point of keeping it out of the source is that a
       * deploy can change it without a commit, not that it is a secret.
       *
       * Static output means this is read at BUILD time, so Coolify has to pass
       * it as a build argument, not a runtime one. See the Dockerfile.
       */
      CONTACT_EMAIL: envField.string({ context: 'server', access: 'public', optional: true }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // The shaders are strings and must survive minification intact; esbuild
      // leaves template literals alone, but be explicit about the target so
      // older Safari still gets a parseable bundle.
      target: 'es2020',
    },
  },
  image: {
    // Every derived size is produced at build time, so there is no runtime
    // image service to configure and nothing to fetch on demand.
    responsiveStyles: false,
  },
});
