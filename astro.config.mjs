// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served as static files by Apache in the Docker image; nothing needs a server.
  output: 'static',
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
